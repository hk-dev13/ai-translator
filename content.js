// content.js

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'translatePage') {
        const { targetLang, aiProvider } = request;
        console.log(`Translating page to ${targetLang} using ${aiProvider}`);

        // Find all text nodes in the body
        const textNodes = findTextNodes(document.body);

        // Collect valid text nodes (skip filtered elements)
        const validNodes = [];
        const validTexts = [];
        textNodes.forEach(node => {
            const originalText = node.nodeValue.trim();
            if (originalText && !isElementScriptOrStyle(node.parentElement)) {
                validNodes.push(node);
                validTexts.push(originalText);
            }
        });

        if (validTexts.length === 0) {
            sendResponse({ status: 'No text to translate.' });
            return true;
        }

        // Split into batches of 100 to avoid backend limit
        const batchSize = 100;
        const promises = [];
        for (let i = 0; i < validTexts.length; i += batchSize) {
            const batchTexts = validTexts.slice(i, i + batchSize);
            const batchNodes = validNodes.slice(i, i + batchSize);
            promises.push(
                translateBatchWithCache(batchTexts, targetLang, aiProvider).then(translations => {
                    // Apply translations for this batch
                    translations.forEach((translation, idx) => {
                        const nodeIndex = i + idx;
                        if (validNodes[nodeIndex]) {
                            validNodes[nodeIndex].nodeValue = translation;
                        }
                    });
                })
            );
        }

        // Wait for all batches
        Promise.all(promises).then(() => {
            console.log('All batches translated.');
        });

        sendResponse({ status: 'Batch translation initiated.' });
        return true;
    }
});

function findTextNodes(element) {
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );

    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
        textNodes.push(node);
    }
    return textNodes;
}

function isElementScriptOrStyle(element) {
    const skipTags = ['SCRIPT', 'STYLE', 'CODE', 'PRE', 'NAV', 'FOOTER', 'HEADER', 'ASIDE', 'INPUT', 'TEXTAREA', 'BUTTON'];
    return skipTags.includes(element.tagName) || element.closest('code, pre, nav, footer, header, aside, input, textarea, button');
}

// Fungsi hash sederhana untuk cache key
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString();
}

// Fungsi untuk translate dengan cache (single)
async function translateWithCache(text, targetLang, aiProvider) {
    const pageUrl = window.location.href;
    const cacheKey = `${pageUrl}-${simpleHash(text)}-${targetLang}`;

    // Cek cache
    const cached = await chrome.storage.local.get([cacheKey]);
    if (cached[cacheKey]) {
        return cached[cacheKey];
    }

    // Jika tidak ada cache, translate
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(
            {
                action: 'getTranslation',
                text: text,
                targetLang: targetLang,
                aiProvider: aiProvider
            },
            (response) => {
                if (chrome.runtime.lastError) {
                    console.error(chrome.runtime.lastError.message);
                    resolve(text); // Fallback to original
                } else if (response && response.translation) {
                    // Simpan ke cache
                    chrome.storage.local.set({ [cacheKey]: response.translation });
                    resolve(response.translation);
                } else {
                    resolve(text);
                }
            }
        );
    });
}

// Fungsi untuk batch translate dengan cache
async function translateBatchWithCache(texts, targetLang, aiProvider) {
    const pageUrl = window.location.href;
    const cacheKeys = texts.map(text => `${pageUrl}-${simpleHash(text)}-${targetLang}`);

    // Cek cache untuk semua
    const cachedData = await chrome.storage.local.get(cacheKeys);
    const results = [];
    const uncachedTexts = [];
    const uncachedIndices = [];

    texts.forEach((text, index) => {
        const cacheKey = cacheKeys[index];
        if (cachedData[cacheKey]) {
            results[index] = cachedData[cacheKey];
        } else {
            uncachedTexts.push(text);
            uncachedIndices.push(index);
            results[index] = null; // Placeholder
        }
    });

    // Jika ada yang belum cache, translate batch
    if (uncachedTexts.length > 0) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage(
                {
                    action: 'getBatchTranslation',
                    texts: uncachedTexts,
                    targetLang: targetLang,
                    aiProvider: aiProvider
                },
                (response) => {
                    if (chrome.runtime.lastError) {
                        console.error(chrome.runtime.lastError.message);
                        // Fallback to original
                        uncachedIndices.forEach(i => results[i] = texts[i]);
                    } else if (response && response.translations) {
                        // Simpan ke cache dan set results
                        const cacheToSet = {};
                        response.translations.forEach((translation, idx) => {
                            const originalIndex = uncachedIndices[idx];
                            results[originalIndex] = translation;
                            cacheToSet[cacheKeys[originalIndex]] = translation;
                        });
                        chrome.storage.local.set(cacheToSet);
                    } else {
                        // Fallback
                        uncachedIndices.forEach(i => results[i] = texts[i]);
                    }
                    resolve(results);
                }
            );
        });
    } else {
        return results;
    }
}
