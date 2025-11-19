// background.js

// API keys sekarang ditangani di backend middleware untuk keamanan

chrome.runtime.onInstalled.addListener(() => {
    console.log("AI Web Translator extension installed.");
});

// Listener utama untuk pesan dari content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getTranslation") {
        const { text, targetLang, aiProvider } = request;

        // Dispatch ke fungsi terjemahan yang sesuai
        getTranslation(text, targetLang, aiProvider)
            .then(translatedText => {
                sendResponse({ translation: translatedText });
            })
            .catch(error => {
                console.error(`Translation error with ${aiProvider}:`, error);
                sendResponse({ translation: `[Error] ${text}` });
            });

        return true; // Respons asynchronous
    } else if (request.action === "getBatchTranslation") {
        const { texts, targetLang, aiProvider } = request;

        // Batch translate
        translateViaBackendBatch(texts, targetLang, aiProvider)
            .then(translations => {
                sendResponse({ translations });
            })
            .catch(error => {
                console.error(`Batch translation error with ${aiProvider}:`, error);
                sendResponse({ translations: texts.map(() => '[Error]') });
            });

        return true;
    }
});

// Fungsi Dispatcher - sekarang via backend
function getTranslation(text, targetLang, provider) {
    return translateViaBackend(text, targetLang, provider);
}

// Fungsi untuk translate via backend middleware (single)
async function translateViaBackend(text, targetLang, provider) {
    const backendUrl = 'https://translator-backend-577398517518.asia-southeast1.run.app/translate';

    try {
        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: text,
                targetLang: targetLang,
                provider: provider
            })
        });

        if (!response.ok) {
            throw new Error(`Backend error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.translation || '[Translation failed]';
    } catch (error) {
        console.error('Translation via backend failed:', error);
        return `[Error: ${error.message}]`;
    }
}

// Fungsi untuk batch translate via backend
async function translateViaBackendBatch(texts, targetLang, provider) {
    const backendUrl = 'https://translator-backend-577398517518.asia-southeast1.run.app/translate';

    try {
        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                texts: texts,
                targetLang: targetLang,
                provider: provider
            })
        });

        if (!response.ok) {
            throw new Error(`Backend error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.translations || texts.map(() => '[Translation failed]');
    } catch (error) {
        console.error('Batch translation via backend failed:', error);
        return texts.map(() => `[Error: ${error.message}]`);
    }
}