const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const PORT = 3000;
const CONFIG_PATH = path.join(__dirname, 'config.json');
const NUMEROS_PATH = path.join(__dirname, 'numeros.txt');
const LOG_PATH = path.join(__dirname, 'log_envios.txt');
const PROGRESSO_PATH = path.join(__dirname, 'progresso.json');

// ===== ESTADO GLOBAL =====

let whatsappClient = null;
let isClientReady = false;
let isSending = false;
let shouldStop = false;
let stats = { enviados: 0, erros: 0, total: 0, pulados: 0 };

// ===== UTILIDADES =====

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomEntre(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function horaAtual() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function dataAtual() {
  return new Date().toLocaleDateString('pt-BR');
}

function emitLog(tipo, msg) {
  const hora = horaAtual();
  io.emit('log', { tipo, msg });

  const cores = {
    info: chalk.blue,
    sucesso: chalk.green,
    erro: chalk.red,
    aviso: chalk.yellow,
    pausa: chalk.magenta,
  };
  const cor = cores[tipo] || chalk.white;
  console.log(cor(`[${hora}] ${msg}`));
}

function logArquivo(numero, status, detalhes = '') {
  const linha = `[${dataAtual()} ${horaAtual()}] ${numero} - ${status} ${detalhes}\n`;
  fs.appendFileSync(LOG_PATH, linha, 'utf8');
}

// ===== CONFIG =====

function carregarConfig() {
  // Tenta carregar config.json primeiro, senão usa config.js
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch { /* fallback */ }
  }
  // Fallback para config.js
  try {
    delete require.cache[require.resolve('./config')];
    return require('./config');
  } catch {
    return getDefaultConfig();
  }
}

function getDefaultConfig() {
  return {
    mensagem: 'Olá! Tudo bem?\n\nMeu nome é [SEU NOME], trabalho na [SUA EMPRESA].\n\nEstamos com uma oportunidade especial e gostaria de conversar com você.\n\nPosso te explicar rapidamente?',
    variacoesMensagem: [],
    delayMinimo: 45000,
    delayMaximo: 180000,
    delayDigitacaoMin: 3000,
    delayDigitacaoMax: 8000,
    maxMensagensPorSessao: 40,
    pausaACadaXMensagens: 10,
    pausaLongaMin: 300000,
    pausaLongaMax: 600000,
    horarioInicio: 8,
    horarioFim: 20,
  };
}

function salvarConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

// ===== NÚMEROS =====

function carregarNumeros() {
  if (!fs.existsSync(NUMEROS_PATH)) return [];
  const conteudo = fs.readFileSync(NUMEROS_PATH, 'utf8');
  return conteudo
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(num => num.replace(/\D/g, ''));
}

function carregarNumerosRaw() {
  if (!fs.existsSync(NUMEROS_PATH)) return '';
  return fs.readFileSync(NUMEROS_PATH, 'utf8');
}

function salvarNumeros(conteudo) {
  fs.writeFileSync(NUMEROS_PATH, conteudo, 'utf8');
}

// ===== PROGRESSO =====

function carregarProgresso() {
  if (fs.existsSync(PROGRESSO_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(PROGRESSO_PATH, 'utf8'));
    } catch { /* fallback */ }
  }
  return { ultimoIndice: 0, enviados: [], data: dataAtual() };
}

function salvarProgresso(progresso) {
  fs.writeFileSync(PROGRESSO_PATH, JSON.stringify(progresso, null, 2), 'utf8');
}

// ===== ESCOLHER MENSAGEM =====

function escolherMensagem(cfg) {
  const todasMensagens = [cfg.mensagem, ...(cfg.variacoesMensagem || [])].filter(m => m && m.trim());
  if (todasMensagens.length === 0) return cfg.mensagem;
  return todasMensagens[randomEntre(0, todasMensagens.length - 1)];
}

// ===== VERIFICAR HORÁRIO =====

function dentroDoHorario(cfg) {
  const hora = new Date().getHours();
  return hora >= cfg.horarioInicio && hora < cfg.horarioFim;
}

// ===== WHATSAPP CLIENT =====

function criarClient() {
  return new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--disable-gpu',
      ],
    },
  });
}

// ===== ENVIO DE MENSAGENS =====

async function iniciarEnvio() {
  if (isSending) {
    emitLog('aviso', 'Já está enviando mensagens.');
    return;
  }
  if (!isClientReady) {
    emitLog('erro', 'WhatsApp não está conectado.');
    return;
  }

  const cfg = carregarConfig();
  const numeros = carregarNumeros();

  if (numeros.length === 0) {
    emitLog('erro', 'Nenhum número na lista. Adicione números na aba "Números".');
    return;
  }

  if (!cfg.mensagem || !cfg.mensagem.trim()) {
    emitLog('erro', 'Mensagem não configurada. Configure na aba "Mensagem".');
    return;
  }

  isSending = true;
  shouldStop = false;

  const progresso = carregarProgresso();

  // Resetar se mudou o dia
  if (progresso.data !== dataAtual()) {
    progresso.ultimoIndice = 0;
    progresso.enviados = [];
    progresso.data = dataAtual();
    salvarProgresso(progresso);
  }

  stats = {
    enviados: 0,
    erros: 0,
    total: numeros.length - progresso.ultimoIndice,
    pulados: 0,
  };
  io.emit('stats', stats);
  io.emit('status', 'sending');

  emitLog('info', `Iniciando envio para ${stats.total} números (a partir do #${progresso.ultimoIndice + 1})`);
  emitLog('info', `Delay: ${cfg.delayMinimo / 1000}s - ${cfg.delayMaximo / 1000}s | Máx. sessão: ${cfg.maxMensagensPorSessao}`);

  let mensagensEnviadasSessao = 0;

  for (let i = progresso.ultimoIndice; i < numeros.length; i++) {
    // Verificar se deve parar
    if (shouldStop) {
      emitLog('aviso', 'Envio interrompido pelo usuário.');
      break;
    }

    // Limite de sessão
    if (mensagensEnviadasSessao >= cfg.maxMensagensPorSessao) {
      emitLog('aviso', `Limite de ${cfg.maxMensagensPorSessao} mensagens por sessão atingido.`);
      break;
    }

    // Horário
    if (!dentroDoHorario(cfg)) {
      emitLog('pausa', `Fora do horário (${cfg.horarioInicio}h-${cfg.horarioFim}h). Aguardando...`);
      while (!dentroDoHorario(cfg) && !shouldStop) {
        await sleep(60000);
      }
      if (shouldStop) break;
    }

    const numero = numeros[i];
    const chatId = `${numero}@c.us`;

    emitLog('info', `[${i + 1}/${numeros.length}] Processando: ${numero}`);

    try {
      // Verificar registro no WhatsApp
      const isRegistered = await whatsappClient.isRegisteredUser(chatId);

      if (!isRegistered) {
        emitLog('aviso', `${numero} não está no WhatsApp. Pulando...`);
        logArquivo(numero, 'PULADO', 'Não registrado');
        stats.pulados++;
        progresso.ultimoIndice = i + 1;
        salvarProgresso(progresso);
        io.emit('stats', stats);
        continue;
      }

      // Escolher mensagem
      const mensagem = escolherMensagem(cfg);

      // Simular digitação
      const chat = await whatsappClient.getChatById(chatId);
      await chat.sendSeen();

      const tempoDigitacao = randomEntre(cfg.delayDigitacaoMin || 3000, cfg.delayDigitacaoMax || 8000);
      emitLog('info', `Digitando por ${(tempoDigitacao / 1000).toFixed(1)}s...`);
      await chat.sendStateTyping();
      await sleep(tempoDigitacao);
      await chat.clearState();

      // Enviar
      await whatsappClient.sendMessage(chatId, mensagem);

      mensagensEnviadasSessao++;
      stats.enviados++;
      emitLog('sucesso', `✔ Enviado para ${numero} (${mensagensEnviadasSessao}/${cfg.maxMensagensPorSessao})`);
      logArquivo(numero, 'ENVIADO', `Sessão #${mensagensEnviadasSessao}`);

      progresso.ultimoIndice = i + 1;
      progresso.enviados.push(numero);
      salvarProgresso(progresso);
      io.emit('stats', stats);

      // Pausa longa periódica
      if (mensagensEnviadasSessao % cfg.pausaACadaXMensagens === 0 && !shouldStop) {
        const pausaLonga = randomEntre(cfg.pausaLongaMin, cfg.pausaLongaMax);
        emitLog('pausa', `Pausa longa de ${(pausaLonga / 1000 / 60).toFixed(1)} minutos (anti-ban)...`);
        await sleep(pausaLonga);
      }

      // Delay entre mensagens
      if (i < numeros.length - 1 && !shouldStop) {
        const delay = randomEntre(cfg.delayMinimo, cfg.delayMaximo);
        emitLog('info', `Aguardando ${(delay / 1000).toFixed(0)}s antes da próxima...`);
        await sleep(delay);
      }

    } catch (erro) {
      stats.erros++;
      emitLog('erro', `Erro ao enviar para ${numero}: ${erro.message}`);
      logArquivo(numero, 'ERRO', erro.message);
      progresso.ultimoIndice = i + 1;
      salvarProgresso(progresso);
      io.emit('stats', stats);

      const delayErro = randomEntre(30000, 60000);
      emitLog('aviso', `Aguardando ${(delayErro / 1000).toFixed(0)}s após erro...`);
      await sleep(delayErro);
    }
  }

  isSending = false;
  io.emit('status', 'connected');
  io.emit('finished');
  emitLog('sucesso', `Sessão finalizada! ${stats.enviados} enviados, ${stats.erros} erros, ${stats.pulados} pulados.`);
}

// ===== SOCKET.IO =====

io.on('connection', (socket) => {
  console.log(chalk.cyan(`[${horaAtual()}] Cliente conectado à interface`));

  // Enviar estado atual
  if (isClientReady) {
    socket.emit('whatsapp-ready');
    socket.emit('status', isSending ? 'sending' : 'connected');
  }
  socket.emit('stats', stats);

  // Carregar config
  socket.on('load-config', () => {
    const cfg = carregarConfig();
    socket.emit('config-loaded', cfg);
  });

  // Carregar números
  socket.on('load-numeros', () => {
    const raw = carregarNumerosRaw();
    socket.emit('numeros-loaded', raw);
  });

  // Salvar config
  socket.on('save-config', (cfg) => {
    // Manter campos que não vêm da interface
    const atual = carregarConfig();
    const novo = {
      ...atual,
      ...cfg,
      delayDigitacaoMin: atual.delayDigitacaoMin || 3000,
      delayDigitacaoMax: atual.delayDigitacaoMax || 8000,
    };
    salvarConfig(novo);
    emitLog('sucesso', 'Configurações salvas.');
  });

  // Salvar números
  socket.on('save-numeros', (conteudo) => {
    salvarNumeros(conteudo);
    const nums = carregarNumeros();
    emitLog('sucesso', `${nums.length} números salvos.`);
  });

  // Conectar WhatsApp
  socket.on('connect-whatsapp', async () => {
    if (whatsappClient) {
      emitLog('aviso', 'WhatsApp já está conectando/conectado.');
      if (isClientReady) socket.emit('whatsapp-ready');
      return;
    }

    emitLog('info', 'Iniciando WhatsApp Web...');

    whatsappClient = criarClient();

    whatsappClient.on('qr', async (qr) => {
      try {
        const dataUrl = await QRCode.toDataURL(qr, { width: 260, margin: 2 });
        io.emit('qr', dataUrl);
        emitLog('info', 'QR Code gerado. Escaneie com o WhatsApp.');
      } catch (err) {
        emitLog('erro', 'Erro ao gerar QR Code: ' + err.message);
      }
    });

    whatsappClient.on('authenticated', () => {
      io.emit('whatsapp-authenticated');
      emitLog('sucesso', 'Autenticado com sucesso!');
    });

    whatsappClient.on('auth_failure', () => {
      emitLog('erro', 'Falha na autenticação. Tente novamente.');
      whatsappClient = null;
      isClientReady = false;
    });

    whatsappClient.on('ready', () => {
      isClientReady = true;
      io.emit('whatsapp-ready');
      emitLog('sucesso', 'WhatsApp conectado e pronto!');
    });

    whatsappClient.on('disconnected', (reason) => {
      emitLog('erro', `WhatsApp desconectado: ${reason}`);
      isClientReady = false;
      isSending = false;
      shouldStop = true;
      whatsappClient = null;
      io.emit('whatsapp-disconnected');
    });

    try {
      await whatsappClient.initialize();
    } catch (err) {
      emitLog('erro', 'Erro ao inicializar WhatsApp: ' + err.message);
      whatsappClient = null;
    }
  });

  // Iniciar envio
  socket.on('start-sending', () => {
    iniciarEnvio();
  });

  // Parar envio
  socket.on('stop-sending', () => {
    shouldStop = true;
    emitLog('aviso', 'Solicitação de parada recebida. Finalizando após a mensagem atual...');
  });
});

// ===== INICIAR SERVIDOR =====

server.listen(PORT, () => {
  console.log(chalk.cyan('\n╔══════════════════════════════════════════╗'));
  console.log(chalk.cyan('║   BOT WHATSAPP - PROSPECÇÃO DE CLIENTES  ║'));
  console.log(chalk.cyan('╚══════════════════════════════════════════╝\n'));
  console.log(chalk.green(`  ➜ Interface: http://localhost:${PORT}\n`));
  console.log(chalk.gray('  Abra o link acima no navegador para usar o bot.\n'));
});
