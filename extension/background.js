// Service Worker - Gerencia estado global e comunicação entre popup e content script

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(null, (existing) => {
    if (existing && existing.config) return;
    chrome.storage.local.set({
      config: {
        mensagem: '',
        variacoes: [],
        delayMin: 45,
        delayMax: 180,
        digitacaoMin: 3,
        digitacaoMax: 8,
        maxPorSessao: 40,
        pausaCada: 10,
        pausaLongaMin: 5,
        pausaLongaMax: 10,
      },
      numeros: [],
      session: {
        active: false,
        currentIndex: 0,
        stats: { enviados: 0, erros: 0, pulados: 0, total: 0 },
        logs: [],
      },
    });
  });
});

// Ouve mensagens do content script e popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_STATE') {
    chrome.storage.local.get(null, (data) => sendResponse(data));
    return true;
  }

  if (msg.type === 'SAVE_STATE') {
    chrome.storage.local.set(msg.payload, () => sendResponse({ ok: true }));
    return true;
  }
});
