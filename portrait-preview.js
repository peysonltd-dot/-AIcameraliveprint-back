// Derived previews only: never write to Firestore or modify source images.
const sharp = require('sharp');
const crypto = require('crypto');
const cache = new Map();
const pending = new Map();
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
let cacheBytes = 0;
function prune() {
    for (const [key, item] of cache) {
        if (item.expires < Date.now() || cacheBytes > MAX_CACHE_BYTES) {
            cache.delete(key); cacheBytes -= item.bytes.length;
        }
    }
}
async function readSource(source) {
    if (/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(source)) {
        if (source.length > MAX_SOURCE_BYTES * 1.4) throw new Error('Source too large');
        return Buffer.from(source.slice(source.indexOf(',') + 1), 'base64');
    }
    const url = new URL(source);
    if (url.protocol !== 'https:' || !['cdn.leonardo.ai', 'images.leonardo.ai'].includes(url.hostname)) {
        throw new Error('Preview source unsupported');
    }
    const controller = new AbortController();
    // Bounds preview server work only; original downloads have no app timeout.
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
        const response = await fetch(url, { signal: controller.signal, redirect: 'error' });
        if (!response.ok || !response.body) throw new Error('Source unavailable');
        let length = 0; const chunks = [];
        for await (const chunk of response.body) {
            length += chunk.length;
            if (length > MAX_SOURCE_BYTES) { controller.abort(); throw new Error('Source too large'); }
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    } finally { clearTimeout(timer); }
}
async function makePreview(source) {
    const key = crypto.createHash('sha256').update(source).digest('hex');
    prune();
    if (cache.has(key)) return cache.get(key).bytes;
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 2) throw new Error('Preview busy');
    const job = (async () => {
        const original = await readSource(source);
        const resized = sharp(original, { limitInputPixels: 25000000 })
            .rotate().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
        ;
        let bytes = await resized.clone().webp({ quality: 80 }).toBuffer();
        if (bytes.length >= original.length) {
            const png = await resized.clone().png().toBuffer();
            if (png.length < bytes.length) bytes = png;
        }
        // Flat art may already compress very well: never send a larger derivative.
        if (bytes.length >= original.length) bytes = original;
        cache.set(key, { bytes, expires: Date.now() + 5 * 60 * 1000 });
        cacheBytes += bytes.length; prune();
        return bytes;
    })();
    pending.set(key, job);
    try { return await job; } finally { pending.delete(key); }
}
function installPortraitPreview(app, getTask) {
    app.get('/api/preview/:taskId/:design', async (req, res) => {
        res.setHeader('Cache-Control', 'private, no-store');
        if (!/^\d{1,9}$/.test(req.params.taskId) || !['A', 'B'].includes(req.params.design)) {
            return res.status(400).end();
        }
        try {
            const task = await getTask(req.params.taskId);
            const source = task && task[`resultImage${req.params.design}`];
            if (!source) return res.status(404).end();
            const bytes = await makePreview(source);
            const format = (await sharp(bytes).metadata()).format;
            res.type(`image/${format === 'jpg' ? 'jpeg' : format}`).send(bytes);
        } catch (_) { res.status(503).end(); }
    });
}
module.exports = { installPortraitPreview, makePreview };
