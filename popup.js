document.addEventListener('DOMContentLoaded', () => {
    const translateButton = document.getElementById('translate-button');
    const targetLangSelect = document.getElementById('target-lang');
    const customSelect = document.getElementById('ai-provider');
    const selectSelected = customSelect.querySelector('.select-selected');
    const selectItems = customSelect.querySelector('.select-items');
    const autoTranslateToggle = document.getElementById('auto-translate');
    const themeToggle = document.getElementById('theme-toggle');
    const statusElement = document.getElementById('status');
    const spinner = document.getElementById('spinner');
    const historyList = document.getElementById('history-list');

    let selectedProvider = 'openai'; // Default
    let autoTranslateEnabled = false; // Default
    let darkModeEnabled = false; // Default
    let translationHistory = []; // Default

    // Helper function to update status with appropriate styling
    function updateStatus(message, type = 'info') {
        statusElement.textContent = message;
        statusElement.className = type; // Remove previous classes and add new one
    }

    // History functions
    function loadHistory() {
        chrome.storage.sync.get(['translationHistory'], (result) => {
            translationHistory = result.translationHistory || [];
            renderHistory();
        });
    }

    function saveHistory() {
        chrome.storage.sync.set({ translationHistory: translationHistory });
    }

    function addToHistory(fromLang, toLang, provider, pageUrl = '') {
        const now = new Date();
        const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const domain = pageUrl ? new URL(pageUrl).hostname : 'Unknown';

        translationHistory.unshift({
            from: fromLang,
            to: toLang,
            provider: provider,
            time: timeString,
            domain: domain
        });
        // Keep only last 10
        if (translationHistory.length > 10) {
            translationHistory = translationHistory.slice(0, 10);
        }
        saveHistory();
        renderHistory();
    }

    function renderHistory() {
        const viewHistoryBtn = document.getElementById('view-history');
        if (translationHistory.length > 0) {
            viewHistoryBtn.style.display = 'block';
        } else {
            viewHistoryBtn.style.display = 'none';
        }
    }

    function repeatTranslation(item) {
        // Set target language
        targetLangSelect.value = item.to;
        // Set provider
        selectedProvider = item.provider;
        const providerData = {
            openai: { icon: 'assets/logo_ai/openAI.png', text: 'OpenAI' },
            google: { icon: 'assets/logo_ai/google.png', text: 'Google' },
            deepl: { icon: 'assets/logo_ai/deepL.png', text: 'DeepL' }
        };
        const data = providerData[selectedProvider];
        selectSelected.innerHTML = `<img src="${data.icon}" alt="${data.text}" class="provider-icon"><span>${data.text}</span>`;
        chrome.storage.sync.set({ selectedProvider: selectedProvider });

        // Trigger translation
        translateButton.click();
    }

    // Load settings from storage
    chrome.storage.sync.get(['selectedProvider', 'autoTranslateEnabled', 'darkModeEnabled'], (result) => {
        if (result.selectedProvider) {
            selectedProvider = result.selectedProvider;
            // Update custom select display
            const providerData = {
                openai: { icon: 'assets/logo_ai/openAI.png', text: 'OpenAI' },
                google: { icon: 'assets/logo_ai/google.png', text: 'Google' },
                deepl: { icon: 'assets/logo_ai/deepL.png', text: 'DeepL' }
            };
            const data = providerData[selectedProvider];
            selectSelected.innerHTML = `<img src="${data.icon}" alt="${data.text}" class="provider-icon"><span>${data.text}</span>`;
        }
        if (result.autoTranslateEnabled !== undefined) {
            autoTranslateEnabled = result.autoTranslateEnabled;
            autoTranslateToggle.checked = autoTranslateEnabled;
        }
        if (result.darkModeEnabled !== undefined) {
            darkModeEnabled = result.darkModeEnabled;
            themeToggle.checked = darkModeEnabled;
            document.body.setAttribute('data-theme', darkModeEnabled ? 'dark' : 'light');
        }
        loadHistory();
    });

    // View history button
    const viewHistoryBtn = document.getElementById('view-history');
    viewHistoryBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
    });

    // Handle messages from history page
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'repeatTranslation') {
            const item = request.item;
            repeatTranslation(item);
        } else if (request.action === 'openPopup') {
            // Try to open the popup
            if (chrome.action && chrome.action.openPopup) {
                chrome.action.openPopup();
            } else {
                // Fallback: create a new popup window
                chrome.windows.create({
                    url: chrome.runtime.getURL('popup.html'),
                    type: 'popup',
                    width: 300,
                    height: 500
                });
            }
        }
    });

    // Custom select functionality
    selectSelected.addEventListener('click', () => {
        const isOpen = customSelect.classList.toggle('open');
        customSelect.setAttribute('aria-expanded', isOpen);
    });

    selectItems.addEventListener('click', (e) => {
        const item = e.target.closest('div[data-value]');
        if (item) {
            const value = item.getAttribute('data-value');
            const iconSrc = item.querySelector('img').src;
            const text = item.querySelector('span').textContent;

            selectSelected.innerHTML = `<img src="${iconSrc}" alt="${text}" class="provider-icon"><span>${text}</span>`;
            selectedProvider = value;
            chrome.storage.sync.set({ selectedProvider: selectedProvider });
            customSelect.classList.remove('open');
            customSelect.setAttribute('aria-expanded', 'false');
        }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!customSelect.contains(e.target)) {
            customSelect.classList.remove('open');
            customSelect.setAttribute('aria-expanded', 'false');
        }
    });

    // Auto-translate toggle
    autoTranslateToggle.addEventListener('change', () => {
        autoTranslateEnabled = autoTranslateToggle.checked;
        chrome.storage.sync.set({ autoTranslateEnabled: autoTranslateEnabled });

        // Send message to content script to enable/disable auto-translate
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].id) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'toggleAutoTranslate',
                    enabled: autoTranslateEnabled
                });
            }
        });
    });

    // Theme toggle
    themeToggle.addEventListener('change', () => {
        darkModeEnabled = themeToggle.checked;
        chrome.storage.sync.set({ darkModeEnabled: darkModeEnabled });
        document.body.setAttribute('data-theme', darkModeEnabled ? 'dark' : 'light');
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl+T or Cmd+T for translate
        if ((e.ctrlKey || e.metaKey) && e.key === 't') {
            e.preventDefault();
            translateButton.click();
        }
        // Ctrl+D or Cmd+D for dark mode toggle
        if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
            e.preventDefault();
            themeToggle.click();
        }
    });

    // Offline detection
    function updateOnlineStatus() {
        if (!navigator.onLine) {
            updateStatus('Warning: You are currently offline. Translation requires internet connection.', 'error');
        } else {
            updateStatus('', 'info'); // Clear status when back online
        }
    }

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    // Check initial status
    updateOnlineStatus();

    translateButton.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs[0];
            if (activeTab && activeTab.id) {
                const targetLang = targetLangSelect.value;
                const aiProvider = selectedProvider;
                updateStatus(`Translating with ${aiProvider}...`, 'info');
                spinner.style.display = 'block';

                // Send a message to the content script to start translation
                chrome.tabs.sendMessage(
                    activeTab.id,
                    {
                        action: 'translatePage',
                        targetLang: targetLang,
                        aiProvider: aiProvider
                    },
                    (response) => {
                        spinner.style.display = 'none';
                        if (chrome.runtime.lastError) {
                            updateStatus('Error: Connection failed. Please reload the page and try again.', 'error');
                            console.error(chrome.runtime.lastError.message);
                        } else if (response) {
                            if (response.status && (response.status.includes('Error') || response.status.includes('Failed') || response.status.includes('Too many requests'))) {
                                if (response.status.includes('Too many requests')) {
                                    updateStatus('Error: Rate limit exceeded. Please wait a minute before trying again.', 'error');
                                } else {
                                    updateStatus('Error: ' + response.status, 'error');
                                }
                            } else {
                                updateStatus('Success: ' + response.status, 'success');
                                // Add to history
                                const fromLang = 'Page'; // Page content translation
                                const toLang = targetLang;
                                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                                    const pageUrl = tabs[0]?.url || '';
                                    addToHistory(fromLang, toLang, aiProvider, pageUrl);
                                });
                            }
                        } else {
                            updateStatus('Error: An unknown error occurred.', 'error');
                        }
                    }
                );
            } else {
                updateStatus('Error: Cannot access the active tab.', 'error');
                spinner.style.display = 'none';
            }
        });
    });
});
