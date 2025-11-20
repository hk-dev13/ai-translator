// history.js - For the dedicated history page

let translationHistory = [];

document.addEventListener('DOMContentLoaded', () => {
    loadHistory();
    setupEventListeners();
});

function loadHistory() {
    chrome.storage.sync.get(['translationHistory'], (result) => {
        translationHistory = result.translationHistory || [];
        renderHistory();
    });
}

function saveHistory() {
    chrome.storage.sync.set({ translationHistory: translationHistory });
}

function renderHistory() {
    const historyList = document.getElementById('history-list-page');
    historyList.innerHTML = '';

    if (translationHistory.length === 0) {
        historyList.innerHTML = '<li style="text-align: center; color: #999; padding: 20px;">No translation history yet</li>';
        return;
    }

    translationHistory.forEach((item, index) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <div class="history-item" data-index="${index}">
                <div class="history-info">
                    <span class="history-lang">${item.from} → ${item.to}</span>
                    <span class="history-details">${item.domain} • ${item.provider}</span>
                </div>
                <span class="history-time">${item.time}</span>
            </div>
        `;
        li.addEventListener('click', () => repeatTranslation(item));
        historyList.appendChild(li);
    });
}

function repeatTranslation(item) {
    // Send message to popup to update settings and translate
    chrome.runtime.sendMessage({
        action: 'repeatTranslation',
        item: item
    }, () => {
        window.close(); // Close history page
    });
}

function setupEventListeners() {
    const backBtn = document.getElementById('back-btn');
    backBtn.addEventListener('click', () => {
        // Try to focus existing popup, or create new one
        chrome.runtime.sendMessage({ action: 'openPopup' }, () => {
            window.close();
        });
    });

    const clearBtn = document.getElementById('clear-history-page');
    clearBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all translation history?')) {
            translationHistory = [];
            saveHistory();
            renderHistory();
        }
    });
}