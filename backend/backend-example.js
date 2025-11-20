// backend-example.js - Kode untuk backend middleware di Google Cloud Run (Node.js)

// Install dependencies: npm init, npm install express cors helmet express-rate-limit @google-cloud/translate @google-cloud/secret-manager

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Translate } = require('@google-cloud/translate').v2;
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const Redis = require('ioredis');

const app = express();
const port = process.env.PORT || 8080;

// Trust proxy for accurate IP in rate limiting (Cloud Run sets X-Forwarded-For)
app.set('trust proxy', 1);

// Middleware
app.use(helmet());
app.use(cors({ origin: ['chrome-extension://lnnmebafcegjhckaefmjbabocghhhend'] })); 
app.use(express.json({ limit: '1mb' }));

// Rate limiting: 10 requests per minute per IP
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    message: 'Too many requests, please try again later.'
});
app.use(limiter);

// Fungsi untuk ambil credentials dari Secret Manager (JSON service account key)
async function getCredentials() {
    const client = new SecretManagerServiceClient();
    const name = 'projects/chrome-translator-dev/secrets/GOOGLE_TRANSLATE_API_KEY/versions/latest';

    const [version] = await client.accessSecretVersion({ name });
    const jsonString = version.payload.data.toString();
    return JSON.parse(jsonString);
}

// Inisialisasi Google Translate dengan credentials dari Secret Manager
let translate;
let redis;
(async () => {
    try {
        const credentials = await getCredentials();
        translate = new Translate({ credentials });
        console.log('Google Translate initialized successfully');

        // Inisialisasi Redis (Upstash)
        redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379'); // Set REDIS_URL di env
        console.log('Redis connected');
    } catch (error) {
        console.error('Failed to initialize:', error);
        process.exit(1);
    }
})();

// Validasi input
function validateInput(text, targetLang, provider) {
    if (!text || typeof text !== 'string' || text.length > 1000) {
        throw new Error('Invalid text: must be string, max 1000 chars');
    }
    if (!targetLang || typeof targetLang !== 'string') {
        throw new Error('Invalid targetLang');
    }
    if (!['openai', 'google', 'deepl'].includes(provider)) {
        throw new Error('Invalid provider');
    }
}

// Fungsi cache
async function getCache(key) {
    if (!redis) return null;
    return await redis.get(key);
}

async function setCache(key, value, ttl = 3600) { // 1 hour TTL
    if (redis) await redis.setex(key, ttl, value);
}

// Endpoint translate (support single text or batch texts)
app.post('/translate', async (req, res) => {
    try {
        const { text, texts, targetLang, provider } = req.body;

        // Validasi
        if (texts) {
            // Batch mode
            if (!Array.isArray(texts) || texts.length > 100) {
                throw new Error('texts must be array with max 100 items');
            }
            texts.forEach(t => validateInput(t, targetLang, provider));
        } else {
            // Single mode
            validateInput(text, targetLang, provider);
        }

        if (texts) {
            // Batch translate with cache
            const translations = await Promise.all(
                texts.map(async (t) => {
                    const cacheKey = `translate:${t}:${targetLang}`;
                    let cached = await getCache(cacheKey);
                    if (cached) return cached;

                    const [result] = await translate.translate(t, targetLang);
                    await setCache(cacheKey, result);
                    return result;
                })
            );
            res.json({ translations });
        } else {
            // Single translate with cache
            const cacheKey = `translate:${text}:${targetLang}`;
            let cached = await getCache(cacheKey);
            if (cached) return res.json({ translation: cached });

            const [translation] = await translate.translate(text, targetLang);
            await setCache(cacheKey, translation);
            res.json({ translation });
        }
    } catch (error) {
        console.error('Translation error:', error);
        res.status(400).json({ error: error.message });
    }
});

// Health check
app.get('/', (req, res) => {
    res.send('Translation Backend is running');
});

app.listen(port, () => {
    console.log(`Backend listening on port ${port}`);
});

// Untuk deploy ke Cloud Run: gcloud run deploy --source .