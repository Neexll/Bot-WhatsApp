# Bot WhatsApp - Prospecção de Clientes

Bot automatizado para envio de mensagens no WhatsApp com medidas anti-ban integradas.

## Como Usar

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar números

Edite o arquivo `numeros.txt` e adicione os números (um por linha):

```
5511999998888
5521988887777
```

> Formato: código do país (55) + DDD + número, sem espaços.

### 3. Configurar mensagem

Edite o arquivo `config.js` e altere:

- **mensagem** → Sua mensagem principal
- **variacoesMensagem** → Variações da mensagem (anti-ban)
- **delays** → Tempos de espera entre mensagens
- **limites** → Quantidade máxima por sessão

### 4. Executar o bot

```bash
npm start
```

Na primeira vez, escaneie o **QR Code** com o WhatsApp do seu celular.

## Medidas Anti-Ban

O bot implementa várias estratégias para evitar banimento:

| Recurso | Descrição |
|---|---|
| **Delay aleatório** | Tempo variável entre cada mensagem (45s a 3min) |
| **Simulação de digitação** | Mostra "digitando..." antes de enviar |
| **Variação de mensagem** | Alterna entre diferentes versões da mensagem |
| **Pausa longa periódica** | A cada 10 mensagens, pausa de 5-10 minutos |
| **Limite por sessão** | Máximo de 40 mensagens por execução |
| **Horário comercial** | Só envia entre 8h e 20h |
| **Verificação de número** | Pula números não registrados no WhatsApp |

## Recomendações Importantes

1. **Não envie mais de 50 mensagens por dia** para números novos
2. **Use uma conta com pelo menos 1 semana** de uso normal
3. **Tenha contatos salvos** no celular para parecer uma conta real
4. **Varie as mensagens** — adicione mais variações no `config.js`
5. **Não envie links na primeira mensagem** — isso aumenta chance de ban
6. **Comece devagar** — nos primeiros dias, envie 10-15 mensagens apenas
7. **Use o bot em horário comercial** — comportamento mais natural

## Arquivos Gerados

- `log_envios.txt` → Registro de todos os envios (sucesso/erro)
- `progresso.json` → Salva onde parou para continuar depois
- `.wwebjs_auth/` → Sessão do WhatsApp (não delete para não precisar escanear QR novamente)

## Estrutura

```
Bot Whatsapp/
├── bot.js           → Código principal do bot
├── config.js        → Configurações (mensagem, delays, limites)
├── numeros.txt      → Lista de números para envio
├── package.json     → Dependências do projeto
└── README.md        → Este arquivo
```
