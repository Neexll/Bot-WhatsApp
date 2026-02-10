module.exports = {
  // ===== MENSAGEM =====
  // Você pode usar {nome} para inserir o nome do contato (se disponível)
  mensagem: `Olá! Tudo bem?

Meu nome é [SEU NOME], trabalho na [SUA EMPRESA].

Estamos com uma oportunidade especial e gostaria de conversar com você.

Posso te explicar rapidamente?`,

  // ===== VARIAÇÕES DE MENSAGEM (anti-ban) =====
  // O bot escolhe aleatoriamente uma dessas variações para cada envio
  // Isso evita que o WhatsApp detecte mensagens repetidas
  variacoesMensagem: [
    `Oi! Tudo bem com você?

Sou [SEU NOME] da [SUA EMPRESA].

Temos uma novidade que pode te interessar muito.

Posso te contar mais?`,

    `Olá, tudo certo?

Aqui é o(a) [SEU NOME], da [SUA EMPRESA].

Gostaria de te apresentar algo que pode ser muito útil pra você.

Tem um minutinho?`,
  ],

  // ===== DELAYS (em milissegundos) =====
  // Delay MÍNIMO entre mensagens (em ms) - recomendado: 60000 (1 min)
  delayMinimo: 45000,

  // Delay MÁXIMO entre mensagens (em ms) - recomendado: 180000 (3 min)
  delayMaximo: 180000,

  // Delay para simular digitação (em ms)
  delayDigitacaoMin: 3000,
  delayDigitacaoMax: 8000,

  // ===== LIMITES ANTI-BAN =====
  // Máximo de mensagens por sessão (recomendado: 30-50)
  maxMensagensPorSessao: 40,

  // Pausa longa a cada X mensagens (recomendado: 8-15)
  pausaACadaXMensagens: 10,

  // Duração da pausa longa em ms (recomendado: 300000 = 5 min)
  pausaLongaMin: 300000,
  pausaLongaMax: 600000,

  // ===== HORÁRIO DE FUNCIONAMENTO =====
  // O bot só envia mensagens dentro desse horário
  horarioInicio: 8,  // 8h da manhã
  horarioFim: 20,    // 8h da noite

  // ===== ARQUIVOS =====
  arquivoNumeros: 'numeros.txt',
  arquivoLog: 'log_envios.txt',
  arquivoProgresso: 'progresso.json',
};
