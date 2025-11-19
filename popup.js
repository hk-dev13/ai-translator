document.addEventListener('DOMContentLoaded', () => {
    const translateButton = document.getElementById('translate-button');
    const targetLangSelect = document.getElementById('target-lang');
    const aiProviderSelect = document.getElementById('ai-provider');
    const statusElement = document.getElementById('status');

    translateButton.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs[0];
            if (activeTab && activeTab.id) {
                const targetLang = targetLangSelect.value;
                const aiProvider = aiProviderSelect.value;
                statusElement.textContent = `Translating with ${aiProvider}...`;

                // Send a message to the content script to start translation
                chrome.tabs.sendMessage(
                    activeTab.id,
                    {
                        action: 'translatePage',
                        targetLang: targetLang,
                        aiProvider: aiProvider
                    },
                    (response) => {
                        if (chrome.runtime.lastError) {
                            statusElement.textContent = 'Error: Could not connect. Try reloading the page.';
                            console.error(chrome.runtime.lastError.message);
                        } else if (response) {
                            statusElement.textContent = response.status;
                        } else {
                            statusElement.textContent = 'An unknown error occurred.';
                        }
                    }
                );
            } else {
                statusElement.textContent = 'Cannot access the active tab.';
            }
        });
    });
});
