const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const config = require('./config');

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

function logConsole(tipo, msg) {
  const hora = horaAtual();
  switch (tipo) {
    case 'info':
      console.log(chalk.blue(`[${hora}] ℹ  ${msg}`));
      break;
    case 'sucesso':
      console.log(chalk.green(`[${hora}] ✔  ${msg}`));
      break;
    case 'erro':
      console.log(chalk.red(`[${hora}] ✖  ${msg}`));
      break;
    case 'aviso':
      console.log(chalk.yellow(`[${hora}] ⚠  ${msg}`));
      break;
    case 'pausa':
      console.log(chalk.magenta(`[${hora}] ⏸  ${msg}`));
      break;
    default:
      console.log(`[${hora}] ${msg}`);
  }
}

function logArquivo(numero, status, detalhes = '') {
  const linha = `[${dataAtual()} ${horaAtual()}] ${numero} - ${status} ${detalhes}\n`;
  fs.appendFileSync(path.join(__dirname, config.arquivoLog), linha, 'utf8');
}

// ===== CARREGAR NÚMEROS =====

function carregarNumeros() {
  const caminhoArquivo = path.join(__dirname, config.arquivoNumeros);

  if (!fs.existsSync(caminhoArquivo)) {
    logConsole('erro', `Arquivo "${config.arquivoNumeros}" não encontrado!`);
    logConsole('info', 'Crie o arquivo numeros.txt com um número por linha (ex: 5511999998888)');
    process.exit(1);
  }

  const conteudo = fs.readFileSync(caminhoArquivo, 'utf8');
  const numeros = conteudo
    .split('\n')
    .map(linha => linha.trim())
    .filter(linha => linha && !linha.startsWith('#'))
    .map(num => num.replace(/\D/g, '')); // Remove tudo que não é dígito

  if (numeros.length === 0) {
    logConsole('erro', 'Nenhum número encontrado no arquivo!');
    process.exit(1);
  }

  return numeros;
}

// ===== PROGRESSO (para retomar de onde parou) =====

function carregarProgresso() {
  const caminhoProgresso = path.join(__dirname, config.arquivoProgresso);
  if (fs.existsSync(caminhoProgresso)) {
    try {
      const dados = JSON.parse(fs.readFileSync(caminhoProgresso, 'utf8'));
      return dados;
    } catch {
      return { ultimoIndice: 0, enviados: [], data: dataAtual() };
    }
  }
  return { ultimoIndice: 0, enviados: [], data: dataAtual() };
}

function salvarProgresso(progresso) {
  const caminhoProgresso = path.join(__dirname, config.arquivoProgresso);
  fs.writeFileSync(caminhoProgresso, JSON.stringify(progresso, null, 2), 'utf8');
}

// ===== ESCOLHER MENSAGEM =====

function escolherMensagem() {
  const todasMensagens = [config.mensagem, ...config.variacoesMensagem];
  const indice = randomEntre(0, todasMensagens.length - 1);
  return todasMensagens[indice];
}

// ===== VERIFICAR HORÁRIO =====

function dentroDoHorario() {
  const agora = new Date();
  const hora = agora.getHours();
  return hora >= config.horarioInicio && hora < config.horarioFim;
}

async function aguardarHorario() {
  while (!dentroDoHorario()) {
    logConsole('pausa', `Fora do horário de envio (${config.horarioInicio}h - ${config.horarioFim}h). Aguardando...`);
    await sleep(60000); // Verifica a cada 1 minuto
  }
}

// ===== BOT PRINCIPAL =====

async function iniciarBot() {
  console.log(chalk.cyan('\n╔══════════════════════════════════════════╗'));
  console.log(chalk.cyan('║   BOT WHATSAPP - PROSPECÇÃO DE CLIENTES  ║'));
  console.log(chalk.cyan('╚══════════════════════════════════════════╝\n'));

  const numeros = carregarNumeros();
  const progresso = carregarProgresso();

  // Se mudou o dia, resetar progresso
  if (progresso.data !== dataAtual()) {
    progresso.ultimoIndice = 0;
    progresso.enviados = [];
    progresso.data = dataAtual();
    salvarProgresso(progresso);
  }

  logConsole('info', `${numeros.length} números carregados do arquivo`);
  logConsole('info', `Retomando a partir do número ${progresso.ultimoIndice + 1}`);
  logConsole('info', `Limite por sessão: ${config.maxMensagensPorSessao} mensagens`);
  logConsole('info', `Delay entre mensagens: ${config.delayMinimo / 1000}s - ${config.delayMaximo / 1000}s`);
  console.log('');

  // Inicializar cliente WhatsApp
  logConsole('info', 'Iniciando WhatsApp Web...');

  const client = new Client({
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

  client.on('qr', (qr) => {
    console.log('');
    logConsole('info', 'Escaneie o QR Code abaixo com o WhatsApp:');
    console.log('');
    qrcode.generate(qr, { small: true });
    console.log('');
  });

  client.on('authenticated', () => {
    logConsole('sucesso', 'Autenticado com sucesso!');
  });

  client.on('auth_failure', () => {
    logConsole('erro', 'Falha na autenticação. Tente novamente.');
    process.exit(1);
  });

  client.on('disconnected', (reason) => {
    logConsole('erro', `Desconectado: ${reason}`);
    process.exit(1);
  });

  client.on('ready', async () => {
    logConsole('sucesso', 'WhatsApp conectado e pronto!\n');

    let mensagensEnviadasSessao = 0;

    for (let i = progresso.ultimoIndice; i < numeros.length; i++) {
      // Verificar limite de sessão
      if (mensagensEnviadasSessao >= config.maxMensagensPorSessao) {
        logConsole('aviso', `Limite de ${config.maxMensagensPorSessao} mensagens por sessão atingido.`);
        logConsole('info', 'Reinicie o bot mais tarde para continuar de onde parou.');
        break;
      }

      // Verificar horário
      await aguardarHorario();

      const numero = numeros[i];
      const chatId = `${numero}@c.us`;

      logConsole('info', `[${i + 1}/${numeros.length}] Processando: ${numero}`);

      try {
        // Verificar se o número está registrado no WhatsApp
        const isRegistered = await client.isRegisteredUser(chatId);

        if (!isRegistered) {
          logConsole('aviso', `${numero} não está no WhatsApp. Pulando...`);
          logArquivo(numero, 'PULADO', 'Número não registrado no WhatsApp');
          progresso.ultimoIndice = i + 1;
          salvarProgresso(progresso);
          continue;
        }

        // Escolher mensagem aleatória
        const mensagem = escolherMensagem();

        // Simular digitação (anti-ban)
        const chat = await client.getChatById(chatId);
        await chat.sendSeen();

        const tempoDigitacao = randomEntre(config.delayDigitacaoMin, config.delayDigitacaoMax);
        logConsole('info', `Simulando digitação por ${(tempoDigitacao / 1000).toFixed(1)}s...`);
        await chat.sendStateTyping();
        await sleep(tempoDigitacao);
        await chat.clearState();

        // Enviar mensagem
        await client.sendMessage(chatId, mensagem);

        mensagensEnviadasSessao++;
        logConsole('sucesso', `Mensagem enviada para ${numero} (${mensagensEnviadasSessao}/${config.maxMensagensPorSessao})`);
        logArquivo(numero, 'ENVIADO', `Sessão msg #${mensagensEnviadasSessao}`);

        progresso.ultimoIndice = i + 1;
        progresso.enviados.push(numero);
        salvarProgresso(progresso);

        // Pausa longa a cada X mensagens (anti-ban)
        if (mensagensEnviadasSessao % config.pausaACadaXMensagens === 0) {
          const pausaLonga = randomEntre(config.pausaLongaMin, config.pausaLongaMax);
          logConsole('pausa', `Pausa longa de ${(pausaLonga / 1000 / 60).toFixed(1)} minutos (anti-ban)...`);
          await sleep(pausaLonga);
        }

        // Delay aleatório entre mensagens (anti-ban)
        if (i < numeros.length - 1) {
          const delay = randomEntre(config.delayMinimo, config.delayMaximo);
          logConsole('info', `Aguardando ${(delay / 1000).toFixed(0)}s antes da próxima mensagem...\n`);
          await sleep(delay);
        }

      } catch (erro) {
        logConsole('erro', `Erro ao enviar para ${numero}: ${erro.message}`);
        logArquivo(numero, 'ERRO', erro.message);
        progresso.ultimoIndice = i + 1;
        salvarProgresso(progresso);

        // Espera extra em caso de erro (pode ser rate limit)
        const delayErro = randomEntre(30000, 60000);
        logConsole('aviso', `Aguardando ${(delayErro / 1000).toFixed(0)}s após erro...`);
        await sleep(delayErro);
      }
    }

    console.log('');
    logConsole('sucesso', '═══════════════════════════════════════');
    logConsole('sucesso', `Sessão finalizada! ${mensagensEnviadasSessao} mensagens enviadas.`);
    logConsole('sucesso', `Log salvo em: ${config.arquivoLog}`);
    logConsole('sucesso', '═══════════════════════════════════════');

    // Aguardar um pouco antes de desconectar
    await sleep(5000);
    await client.destroy();
    process.exit(0);
  });

  // Inicializar
  await client.initialize();
}

// ===== TRATAMENTO DE ERROS GLOBAIS =====

process.on('uncaughtException', (erro) => {
  logConsole('erro', `Erro não tratado: ${erro.message}`);
  logArquivo('SISTEMA', 'ERRO_FATAL', erro.message);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('');
  logConsole('aviso', 'Bot interrompido pelo usuário (Ctrl+C).');
  logConsole('info', 'O progresso foi salvo. Execute novamente para continuar.');
  process.exit(0);
});

// ===== INICIAR =====

iniciarBot().catch((erro) => {
  logConsole('erro', `Erro fatal: ${erro.message}`);
  process.exit(1);
});
