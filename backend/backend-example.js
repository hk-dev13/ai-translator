// backend-example.js - Backend dengan support Google, DeepL, dan Gemini (Free Tier)

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Translate } = require('@google-cloud/translate').v2;
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { GoogleGenerativeAI } = require('@google/generative-ai'); // Tambahan Library Gemini
const deepl = require('deepl-node');
const Redis = require('ioredis');

const app = express();
const port = process.env.PORT || 8080;

app.set('trust proxy', 1);

// Middleware
app.use(helmet());
// Ganti YOUR_EXTENSION_ID dengan ID ekstensimu jika perlu
app.use(cors({ origin: ['chrome-extension://lnnmebafcegjhckaefmjbabocghhhend'] })); 
app.use(express.json({ limit: '1mb' }));

const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: 'Too many requests, please try again later.'
});
app.use(limiter);

// --- SECRET MANAGER FUNCTIONS ---

async function getGoogleCredentials() {
    const client = new SecretManagerServiceClient();
    const name = 'projects/chrome-translator-dev/secrets/GOOGLE_TRANSLATE_API_KEY/versions/latest';
    const [version] = await client.accessSecretVersion({ name });
    return JSON.parse(version.payload.data.toString());
}

async function getDeepLApiKey() {
    const client = new SecretManagerServiceClient();
    const name = 'projects/577398517518/secrets/DEEPL_API_KEY/versions/latest';
    const [version] = await client.accessSecretVersion({ name });
    return version.payload.data.toString();
}

// Fungsi Baru: Ambil API Key Gemini
async function getGeminiApiKey() {
    const client = new SecretManagerServiceClient();
    // PASTIKAN kamu sudah buat secret 'GEMINI_API_KEY' di Google Cloud Console!
    const name = 'projects/chrome-translator-dev/secrets/GEMINI_API_KEY/versions/latest';
    const [version] = await client.accessSecretVersion({ name });
    return version.payload.data.toString();
}

// --- INITIALIZATION ---

let googleTranslate;
let deeplTranslator;
let geminiModel; // Variabel untuk Gemini
let redis;

(async () => {
    // 1. Google Translate
    try {
        const credentials = await getGoogleCredentials();
        googleTranslate = new Translate({ credentials });
        console.log('Google Translate initialized');
    } catch (error) {
        console.error('Failed Google Translate init:', error.message);
    }

    // 2. DeepL
    try {
        const deeplApiKey = await getDeepLApiKey();
        deeplTranslator = new deepl.Translator(deeplApiKey);
        console.log('DeepL initialized');
    } catch (error) {
        console.error('Failed DeepL init:', error.message);
    }

    // 3. Gemini AI (Baru)
    try {
        const geminiKey = await getGeminiApiKey();
        const genAI = new GoogleGenerativeAI(geminiKey);
        // Pakai model flash biar cepat dan hemat
        geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        console.log('Gemini AI initialized');
    } catch (error) {
        console.error('Failed Gemini init (Did you create the secret?):', error.message);
    }

    // 4. Redis
    try {
        redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        console.log('Redis connected');
    } catch (error) {
        console.error('Failed Redis connection:', error.message);
    }

    console.log('Backend initialization complete');
})();

// --- HELPER FUNCTIONS ---

// Validasi (Limit sudah dinaikkan ke 10000)
function validateInput(text, targetLang, provider) {
    if (!text || typeof text !== 'string' || text.length > 10000) {
        throw new Error('Invalid text: must be string, max 10000 chars');
    }
    if (!targetLang || typeof targetLang !== 'string') {
        throw new Error('Invalid targetLang');
    }
    // Tambahkan 'gemini' ke daftar valid
    if (!['openai', 'google', 'deepl', 'gemini'].includes(provider)) {
        throw new Error('Invalid provider');
    }
}

async function getCache(key) {
    if (!redis) return null;
    return await redis.get(key);
}

async function setCache(key, value, ttl = 3600) {
    if (redis) await redis.setex(key, ttl, value);
}

// Helper DeepL
async function translateWithDeepL(text, targetLang, timeout = 5000) {
    return new Promise(async (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('DeepL timeout')), timeout);
        try {
            const langMap = { 'id': 'id', 'es': 'es', 'fr': 'fr', 'de': 'de', 'ja': 'ja', 'en': 'en-US' };
            const deeplLang = langMap[targetLang] || targetLang;
            const result = await deeplTranslator.translateText(text, null, deeplLang);
            clearTimeout(timer);
            resolve(result.text);
        } catch (error) {
            clearTimeout(timer);
            reject(error);
        }
    });
}

// Helper Gemini (Baru)
async function translateWithGemini(text, targetLang) {
    if (!geminiModel) throw new Error("Gemini model not ready");
    
    // Prompt engineering sederhana agar outputnya hanya terjemahan
    const prompt = `Translate the following text to language code '${targetLang}'. Output ONLY the translated text, no explanations. Text: "${text}"`;
    
    const result = await geminiModel.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
}

// --- ENDPOINTS ---

app.post('/translate', async (req, res) => {
    try {
        const { text, texts, targetLang, provider } = req.body;

        // Logic untuk handle single vs batch
        const inputs = texts ? texts : [text];
        
        // Validasi
        if (texts && (!Array.isArray(texts) || texts.length > 100)) {
             throw new Error('texts must be array with max 100 items');
        }
        inputs.forEach(t => validateInput(t, targetLang, provider));

        // Proses Translasi (Parallel)
        const results = await Promise.all(inputs.map(async (t) => {
            // Cek Cache
            const cacheKey = `translate:${t}:${targetLang}:${provider}`;
            let cached = await getCache(cacheKey);
            if (cached) return cached;

            let result;
            // Switch Provider Logic
            switch (provider) {
                case 'google':
                    [result] = await googleTranslate.translate(t, targetLang);
                    break;
                
                case 'deepl':
                    try {
                        result = await translateWithDeepL(t, targetLang);
                    } catch (err) {
                        console.log('DeepL failed, fallback to Google');
                        [result] = await googleTranslate.translate(t, targetLang);
                    }
                    break;
                
                case 'openai': // Fallback: User pilih OpenAI di UI -> Kita pakai Gemini di Backend
                case 'gemini':
                    try {
                        result = await translateWithGemini(t, targetLang);
                    } catch (err) {
                        console.log('Gemini failed, fallback to Google:', err.message);
                        [result] = await googleTranslate.translate(t, targetLang);
                    }
                    break;
                
                default:
                    throw new Error(`Unsupported provider: ${provider}`);
            }

            // Simpan Cache
            await setCache(cacheKey, result);
            return result;
        }));

        if (texts) {
            res.json({ translations: results });
        } else {
            res.json({ translation: results[0] });
        }

    } catch (error) {
        console.error('Translation error:', error);
        res.status(400).json({ error: error.message });
    }
});

app.get('/', (req, res) => res.send('Translation Backend is running'));

app.listen(port, () => console.log(`Backend listening on port ${port}`));