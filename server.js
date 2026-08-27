/**
 * PEYSON AI 現場肖像系統後端
 * 支援：原機台拍照、手機掃碼上傳、AI 任務佇列、Firebase 同步與飛鵝出票。
 */
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { initializeApp } = require('firebase/app');
const {
    getFirestore, doc, setDoc, getDoc, collection, getDocs,
    updateDoc, deleteDoc, runTransaction
} = require('firebase/firestore');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const appId = (process.env.APP_ID || 'photo-booth-app').trim();
const LEONARDO_API_KEY = (process.env.LEONARDO_API_KEY || '').trim();
const MAX_CONCURRENT_JOBS = Math.max(1, Number(process.env.MAX_CONCURRENT_JOBS || 2));
const SESSION_TTL_MINUTES = Math.max(2, Number(process.env.SESSION_TTL_MINUTES || 5));
const MAX_IMAGE_DATA_URL_LENGTH = Math.max(500000, Number(process.env.MAX_IMAGE_DATA_URL_LENGTH || 950000));

app.use(cors());
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ limit: '12mb', extended: true }));

let db;
let useFirebase = false;
let ticketCounter = 1;
let counterMutex = Promise.resolve();
let cloudSyncPromise = Promise.resolve();
let localTasksCache = {};
let qrSessionsCache = {};
let systemConfig = { frontMode: 'camera', updatedAt: null };

const generationQueue = [];
const queuedTaskIds = new Set();
let activeGenerationJobs = 0;

const publicDoc = (id) => doc(db, 'artifacts', appId, 'public', id);
const nowTaipei = () => new Date().toLocaleTimeString('zh-TW', {
    timeZone: 'Asia/Taipei', hour12: false
});
const nowIso = () => new Date().toISOString();

function sanitizeMode(mode) {
    return ['camera', 'qr_upload', 'maintenance'].includes(mode) ? mode : null;
}

function isValidDataImage(image) {
    return typeof image === 'string' &&
        /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(image) &&
        image.length <= MAX_IMAGE_DATA_URL_LENGTH;
}

function imageValidationError(image) {
    if (typeof image !== 'string' || !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(image)) {
        return '圖片格式不支援，請使用 JPEG、PNG 或 WebP';
    }
    if (image.length > MAX_IMAGE_DATA_URL_LENGTH) {
        return '圖片壓縮後仍然過大，請重新選擇照片';
    }
    return null;
}

async function savePublicDoc(id, data, merge = true) {
    if (!useFirebase) return;
    if (merge) await setDoc(publicDoc(id), data, { merge: true });
    else await setDoc(publicDoc(id), data);
}

async function readPublicDoc(id) {
    if (!useFirebase) return null;
    const snapshot = await getDoc(publicDoc(id));
    return snapshot.exists() ? snapshot.data() : null;
}

if (process.env.FIREBASE_CONFIG) {
    try {
        let configStr = process.env.FIREBASE_CONFIG.trim();
        let firebaseConfig;
        try {
            firebaseConfig = JSON.parse(configStr);
        } catch (_) {
            const formatted = configStr
                .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
                .replace(/'/g, '"');
            firebaseConfig = JSON.parse(formatted);
        }
        db = getFirestore(initializeApp(firebaseConfig));
        useFirebase = true;
        console.log('🔥 Firebase 雲端資料庫連線成功');
        cloudSyncPromise = syncStateFromCloud();
    } catch (error) {
        console.error('❌ Firebase 初始化失敗:', error.message);
    }
} else {
    console.warn('⚠️ FIREBASE_CONFIG 未設定，目前只使用 Render 記憶體暫存');
}

async function syncStateFromCloud() {
    if (!useFirebase) return;
    try {
        const snapshot = await getDocs(collection(db, 'artifacts', appId, 'public'));
        let maxId = 0;
        let cloudCounter = null;
        const tasksToResume = [];

        snapshot.forEach((item) => {
            const id = item.id;
            const data = item.data();
            if (id === '_config') {
                systemConfig = { ...systemConfig, ...data };
                return;
            }
            if (id === '_counter') {
                cloudCounter = Number(data.next || 1);
                return;
            }
            if (id.startsWith('_session_')) {
                const sessionId = id.replace('_session_', '');
                qrSessionsCache[sessionId] = data;
                if (data.status === 'waiting_upload' && Date.now() > Number(data.expiresAt || 0)) {
                    qrSessionsCache[sessionId].status = 'expired';
                }
                return;
            }
            if (!/^\d+$/.test(id)) return;

            const numericId = Number(id);
            if (numericId > maxId) maxId = numericId;
            const sourceStored = !!data.sourceImage;
            localTasksCache[id] = { ...data, id, sourceStored };

            if (['completed', 'failed'].includes(data.status)) {
                delete localTasksCache[id].sourceImage;
            } else if (['queued', 'pending', 'generating'].includes(data.status)) {
                tasksToResume.push(id);
            }
        });

        ticketCounter = Math.max(maxId + 1, cloudCounter || 1);
        await savePublicDoc('_counter', { type: 'counter', next: ticketCounter });
        console.log(`🎯 流水號續接成功，下一位 #${String(ticketCounter).padStart(3, '0')}`);
        tasksToResume.forEach(taskId => enqueueGeneration(taskId));
    } catch (error) {
        console.error('⚠️ Firebase 歷史資料同步失敗:', error.message);
    }
}

async function allocateTaskId() {
    const allocate = async () => {
        await cloudSyncPromise;
        if (useFirebase) {
            try {
                const number = await runTransaction(db, async transaction => {
                    const ref = publicDoc('_counter');
                    const snapshot = await transaction.get(ref);
                    const storedNext = snapshot.exists() ? Number(snapshot.data().next || 1) : 1;
                    const next = Math.max(storedNext, ticketCounter);
                    transaction.set(ref, { type: 'counter', next: next + 1, updatedAt: nowIso() }, { merge: true });
                    return next;
                });
                ticketCounter = Math.max(ticketCounter, number + 1);
                return String(number).padStart(3, '0');
            } catch (error) {
                console.error('⚠️ 雲端流水號配置失敗，改用單機序號:', error.message);
            }
        }
        const number = ticketCounter++;
        return String(number).padStart(3, '0');
    };

    const result = counterMutex.then(allocate, allocate);
    counterMutex = result.catch(() => undefined);
    return result;
}

async function getTask(taskId, includeSource = false) {
    let task = localTasksCache[taskId] || null;
    if (task && (!includeSource || task.sourceImage)) return task;
    const cloudTask = await readPublicDoc(taskId);
    if (!cloudTask) return task;
    task = { ...task, ...cloudTask, id: taskId, sourceStored: !!cloudTask.sourceImage || !!task?.sourceStored };
    localTasksCache[taskId] = task;
    return task;
}

async function createTask(image, entryMode = 'camera', sessionId = null) {
    const taskId = await allocateTaskId();
    const task = {
        id: taskId, type: 'task', entryMode, sessionId,
        sourceImage: image, sourceStored: true, status: 'queued',
        resultImageA: null, resultImageB: null,
        generationIdA: null, generationIdB: null,
        chosenDesign: null, processStatus: '製作中', remark: '',
        createdAt: nowTaipei(), createdAtIso: nowIso()
    };
    localTasksCache[taskId] = task;
    await savePublicDoc(taskId, task, false);
    enqueueGeneration(taskId);
    return task;
}

function enqueueGeneration(taskId) {
    if (!taskId || queuedTaskIds.has(taskId)) return;
    const task = localTasksCache[taskId];
    if (task && task.status === 'completed') return;
    generationQueue.push(taskId);
    queuedTaskIds.add(taskId);
    if (task) task.status = 'queued';
    processGenerationQueue();
}

async function processGenerationQueue() {
    while (activeGenerationJobs < MAX_CONCURRENT_JOBS && generationQueue.length > 0) {
        const taskId = generationQueue.shift();
        queuedTaskIds.delete(taskId);
        activeGenerationJobs += 1;

        (async () => {
            try {
                const task = await getTask(taskId, true);
                if (!task) throw new Error('找不到任務資料');
                task.status = 'generating';
                await savePublicDoc(taskId, { status: 'generating', remark: '' });

                if (!LEONARDO_API_KEY) throw new Error('Render 尚未設定 LEONARDO_API_KEY');
                if (task.generationIdA && task.generationIdB) {
                    await pollAndSaveResults(taskId, task.generationIdA, task.generationIdB);
                } else {
                    if (!task.sourceImage) throw new Error('找不到原始照片');
                    await generateLeonardoDualStyles(taskId, task.sourceImage);
                }
            } catch (error) {
                console.error(`❌ AI 任務 #${taskId} 失敗:`, error.message);
                const task = localTasksCache[taskId];
                if (task) {
                    task.status = 'failed';
                    task.remark = `失敗: ${error.message}`;
                }
                await savePublicDoc(taskId, { status: 'failed', remark: `失敗: ${error.message}` }).catch(() => undefined);
            } finally {
                const task = localTasksCache[taskId];
                if (task && ['completed', 'failed'].includes(task.status)) delete task.sourceImage;
                activeGenerationJobs -= 1;
                setImmediate(processGenerationQueue);
            }
        })();
    }
}

async function uploadToLeonardoS3(base64Image) {
    const initResponse = await fetch('https://cloud.leonardo.ai/api/rest/v1/init-image', {
        method: 'POST',
        headers: { accept: 'application/json', authorization: `Bearer ${LEONARDO_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ extension: 'jpg' })
    });
    if (!initResponse.ok) throw new Error(`Leonardo 初始化照片失敗: ${await initResponse.text()}`);

    const uploadData = await initResponse.json();
    const init = uploadData.uploadInitImage;
    if (!init?.id || !init?.url || !init?.fields) throw new Error('Leonardo 未回傳照片上傳資訊');

    const imageBuffer = Buffer.from(base64Image.replace(/^data:image\/[^;]+;base64,/i, ''), 'base64');
    const formData = new FormData();
    Object.entries(JSON.parse(init.fields)).forEach(([key, value]) => formData.append(key, value));
    formData.append('file', new Blob([imageBuffer], { type: 'image/jpeg' }), 'image.jpg');

    const uploadResponse = await fetch(init.url, { method: 'POST', body: formData });
    if (!uploadResponse.ok) throw new Error(`Leonardo S3照片上傳失敗: ${uploadResponse.status}`);
    return init.id;
}

async function requestLeonardoGeneration(model, styleId, prompt, guestImageId) {
    const response = await fetch('https://cloud.leonardo.ai/api/rest/v2/generations', {
        method: 'POST',
        headers: { accept: 'application/json', authorization: `Bearer ${LEONARDO_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
            model, public: false,
            parameters: {
                height: 1024, width: 1024, prompt_enhance: 'OFF', quantity: 1, quality: 'LOW',
                style_ids: [styleId], prompt,
                guidances: { image_reference: [{ image: { id: guestImageId, type: 'UPLOADED' }, strength: 'MID' }] }
            }
        })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || `Leonardo生圖請求失敗: ${response.status}`);
    return data.generate?.generationId || data.generationId || data.sdGenerationJob?.generationId;
}

async function generateLeonardoDualStyles(taskId, base64Image) {
    const guestImageId = await uploadToLeonardoS3(base64Image);
    const promptBase = 'Please analyze the physical characteristics of the person in the uploaded photo, including hairstyle, hair color, clothing style and color, glasses and accessories. Retain these characteristics and reshape the person into a minimalist hand-drawn chibi avatar. Use slightly thick black hand-drawn outlines with rough crayon or pencil edges, simple flat coloring, no complex gradients, extremely simplified facial features, light pink blush, and a solid clean white background.';
    const [generationIdA, generationIdB] = await Promise.all([
        requestLeonardoGeneration('gemini-2.5-flash-image', '6fedbf1f-4a17-45ec-84fb-92fe524a29ef', `${promptBase} Use round eyes and a small nose.`, guestImageId),
        requestLeonardoGeneration('gpt-image-2', '645e4195-f63d-4715-a3f2-3fb1e6eb8c70', `${promptBase} Use bean-shaped eyes and a small nose.`, guestImageId)
    ]);
    if (!generationIdA || !generationIdB) throw new Error('Leonardo 未回傳完整任務ID');

    localTasksCache[taskId].generationIdA = generationIdA;
    localTasksCache[taskId].generationIdB = generationIdB;
    await savePublicDoc(taskId, { generationIdA, generationIdB, status: 'generating' });
    await pollAndSaveResults(taskId, generationIdA, generationIdB);
}

async function readLeonardoGeneration(generationId) {
    const response = await fetch(`https://cloud.leonardo.ai/api/rest/v1/generations/${generationId}`, {
        headers: { authorization: `Bearer ${LEONARDO_API_KEY}` }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || `查詢Leonardo任務失敗: ${response.status}`);
    return data.generations_by_pk;
}

async function pollAndSaveResults(taskId, generationIdA, generationIdB) {
    let resultA = localTasksCache[taskId]?.resultImageA || null;
    let resultB = localTasksCache[taskId]?.resultImageB || null;
    const maxAttempts = 180;

    for (let attempt = 1; attempt <= maxAttempts && (!resultA || !resultB); attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
            if (!resultA) {
                const jobA = await readLeonardoGeneration(generationIdA);
                if (jobA?.status === 'COMPLETE' && jobA.generated_images?.[0]?.url) resultA = jobA.generated_images[0].url;
                if (jobA?.status === 'FAILED') resultA = 'FAILED';
            }
            if (!resultB) {
                const jobB = await readLeonardoGeneration(generationIdB);
                if (jobB?.status === 'COMPLETE' && jobB.generated_images?.[0]?.url) resultB = jobB.generated_images[0].url;
                if (jobB?.status === 'FAILED') resultB = 'FAILED';
            }
            if (resultA === 'FAILED' || resultB === 'FAILED') {
                throw new Error(`Leonardo退件：${resultA === 'FAILED' ? 'A款' : ''}${resultB === 'FAILED' ? 'B款' : ''}`);
            }
            if (resultA && resultB) {
                const task = localTasksCache[taskId];
                task.resultImageA = resultA;
                task.resultImageB = resultB;
                task.status = 'completed';
                task.remark = '';
                await savePublicDoc(taskId, { resultImageA: resultA, resultImageB: resultB, status: 'completed', remark: '' });
                console.log(`🎉 任務 #${taskId} 雙風格生成完成`);
                return;
            }
        } catch (error) {
            if (/Leonardo退件/.test(error.message)) throw error;
            if (attempt === maxAttempts) throw error;
            if (attempt % 10 === 0) console.warn(`⚠️ 任務 #${taskId} 輪詢暫時失敗:`, error.message);
        }
    }
    throw new Error('AI生成超過6分鐘，請從後台重新處理');
}

async function feieRequest(apiname, extra = {}) {
    const user = (process.env.FEIE_USER || '').trim();
    const ukey = (process.env.FEIE_UKEY || '').trim();
    const sn = (process.env.FEIE_SN || '961820398').trim();
    if (!user || !ukey) throw new Error('Render尚未設定飛鵝出票機帳號');

    const stime = Math.floor(Date.now() / 1000);
    const sig = crypto.createHash('sha1').update(user + ukey + stime).digest('hex');
    const params = new URLSearchParams({ user, stime: String(stime), sig, apiname, sn, ...extra });
    const response = await fetch('https://api.jp.feieyun.com/Api/Open/', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params
    });
    const text = await response.text();
    try { return JSON.parse(text); } catch (_) { return { data: text }; }
}

async function triggerFeiePrint(task) {
    const content = [
        '<CB>專屬禮品兌換</CB><BR>', '<C>--------------------------------</C><BR>',
        `<BR><CB>${task.id}</CB><BR><BR>`, '<C>--------------------------------</C><BR>',
        `<C>排隊時間：${task.createdAt}</C><BR>`, '<C>--------------------------------</C><BR>',
        '<C><B>領取說明：</B></C><BR>', '<C>領取時請出示此號碼牌</C><BR>',
        '<C>交由工作人員兌換您的禮品</C><BR><BR>', '<CB>～感謝您的參與～</CB><BR>',
        '<CB>～祝您體驗愉快～</CB><BR>'
    ].join('');
    return feieRequest('Open_printMsg', { content, times: '1' });
}

app.get('/health', (_req, res) => {
    res.json({ success: true, firebase: useFirebase, queued: generationQueue.length, active: activeGenerationJobs, maxConcurrentJobs: MAX_CONCURRENT_JOBS });
});

app.get('/api/config', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, frontMode: systemConfig.frontMode || 'camera', updatedAt: systemConfig.updatedAt || null });
});

app.post('/api/qr-session', async (_req, res) => {
    try {
        const sessionId = crypto.randomBytes(8).toString('hex');
        const expiresAt = Date.now() + SESSION_TTL_MINUTES * 60 * 1000;
        const session = {
            type: 'uploadSession', sessionId, status: 'waiting_upload', sourceImage: null,
            taskId: null, createdAt: Date.now(), createdAtIso: nowIso(), expiresAt
        };
        qrSessionsCache[sessionId] = session;
        await savePublicDoc(`_session_${sessionId}`, session, false);
        res.json({ success: true, sessionId, expiresAt, status: session.status });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/qr-session/:sessionId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        const sessionId = req.params.sessionId;
        let session = qrSessionsCache[sessionId] || await readPublicDoc(`_session_${sessionId}`);
        if (!session) return res.status(404).json({ success: false, error: '找不到此QR Code工作階段' });
        qrSessionsCache[sessionId] = session;
        if (session.status === 'waiting_upload' && Date.now() > Number(session.expiresAt || 0)) {
            session.status = 'expired';
            session.sourceImage = null;
            await savePublicDoc(`_session_${sessionId}`, { status: 'expired', sourceImage: null });
        }
        res.json({
            success: true, status: session.status, expiresAt: session.expiresAt,
            taskId: session.taskId || null,
            sourceImage: req.query.includeImage === '1' ? session.sourceImage || null : undefined
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/qr-session/:sessionId/photo', async (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        let session = qrSessionsCache[sessionId] || await readPublicDoc(`_session_${sessionId}`);
        if (!session) return res.status(404).json({ success: false, error: 'QR Code無效' });
        if (session.status === 'photo_ready') return res.json({ success: true, status: 'photo_ready' });
        if (session.status !== 'waiting_upload' || Date.now() > Number(session.expiresAt || 0)) {
            session.status = 'expired';
            await savePublicDoc(`_session_${sessionId}`, { status: 'expired', sourceImage: null });
            return res.status(410).json({ success: false, error: 'QR Code已過期' });
        }
        const validationError = imageValidationError(req.body.image);
        if (validationError) return res.status(413).json({ success: false, error: validationError });

        session = { ...session, sourceImage: req.body.image, status: 'photo_ready', uploadedAt: nowIso() };
        qrSessionsCache[sessionId] = session;
        await savePublicDoc(`_session_${sessionId}`, session);
        res.json({ success: true, status: 'photo_ready' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/qr-session/:sessionId/generate', async (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        let session = qrSessionsCache[sessionId] || await readPublicDoc(`_session_${sessionId}`);
        if (!session) return res.status(404).json({ success: false, error: '找不到工作階段' });
        if (session.taskId) {
            const existingTask = await getTask(session.taskId);
            return res.json({ success: true, taskId: session.taskId, status: existingTask?.status || 'queued', reused: true });
        }
        if (session.status !== 'photo_ready' || !isValidDataImage(session.sourceImage)) {
            return res.status(400).json({ success: false, error: '尚未收到可使用的照片' });
        }

        const task = await createTask(session.sourceImage, 'qr_upload', sessionId);
        session.taskId = task.id;
        session.status = 'generating';
        session.sourceImage = null;
        qrSessionsCache[sessionId] = session;
        await savePublicDoc(`_session_${sessionId}`, { taskId: task.id, status: 'generating', sourceImage: null });
        res.json({ success: true, taskId: task.id, status: task.status });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/upload', async (req, res) => {
    try {
        const validationError = imageValidationError(req.body.image);
        if (validationError) return res.status(413).json({ success: false, error: validationError });
        const task = await createTask(req.body.image, 'camera');
        res.json({ success: true, taskId: task.id, status: task.status });
    } catch (error) {
        console.error('建立拍照任務失敗:', error);
        res.status(500).json({ success: false, error: '伺服器錯誤' });
    }
});

app.get('/api/status/:taskId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    try {
        const task = await getTask(req.params.taskId);
        if (!task) return res.status(404).json({ success: false, error: '找不到該號碼任務' });
        res.json({
            success: true, status: task.status, resultImageA: task.resultImageA,
            resultImageB: task.resultImageB, chosenDesign: task.chosenDesign,
            processStatus: task.processStatus, remark: task.remark || ''
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/choice/:taskId', async (req, res) => {
    try {
        const choice = String(req.body.choice || '').toUpperCase();
        if (!['A', 'B'].includes(choice)) return res.status(400).json({ success: false, error: '選擇必須是A或B' });
        const task = await getTask(req.params.taskId);
        if (!task) return res.status(404).json({ success: false, error: '找不到該任務' });
        task.chosenDesign = choice;
        await savePublicDoc(task.id, { chosenDesign: choice, submittedAt: nowIso() });
        triggerFeiePrint(task).catch(error => console.error('出票失敗:', error.message));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/admin/front-mode', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, frontMode: systemConfig.frontMode || 'camera', updatedAt: systemConfig.updatedAt || null });
});

app.post('/api/admin/front-mode', async (req, res) => {
    try {
        const mode = sanitizeMode(req.body.mode);
        if (!mode) return res.status(400).json({ success: false, error: '不支援的前台模式' });
        systemConfig = { frontMode: mode, updatedAt: nowIso() };
        await savePublicDoc('_config', { type: 'config', ...systemConfig });
        res.json({ success: true, ...systemConfig });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/admin/all-tasks', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const all = Object.values(localTasksCache)
        .filter(task => task?.type !== 'uploadSession')
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));

    if (req.query.lightweight === 'true') {
        const tasks = all.map(task => {
            const item = { ...task };
            item.hasSourceImage = !!item.sourceImage || !!item.sourceStored;
            delete item.sourceImage;
            item.hasResultImageA = !!item.resultImageA;
            item.hasResultImageB = !!item.resultImageB;
            if (item.resultImageA?.startsWith('data:')) delete item.resultImageA;
            if (item.resultImageB?.startsWith('data:')) delete item.resultImageB;
            return item;
        });
        return res.json({ success: true, tasks });
    }
    res.json({ success: true, tasks: all });
});

app.get('/api/admin/task-source-image/:taskId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const task = await getTask(req.params.taskId, true);
    res.json({ success: true, sourceImage: task?.sourceImage || null });
});

app.get('/api/admin/task-result-images/:taskId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const task = await getTask(req.params.taskId);
    res.json({ success: true, resultImageA: task?.resultImageA || null, resultImageB: task?.resultImageB || null });
});

app.post('/api/admin/upload-result-dual/:taskId', async (req, res) => {
    try {
        const task = await getTask(req.params.taskId);
        if (!task) return res.status(404).json({ success: false, error: '找不到該任務' });
        for (const field of ['resultImageA', 'resultImageB']) {
            if (req.body[field]) {
                const validationError = imageValidationError(req.body[field]);
                if (validationError) return res.status(413).json({ success: false, error: validationError });
                task[field] = req.body[field];
            }
        }
        if (task.resultImageA && task.resultImageB) {
            task.status = 'completed';
            task.remark = '';
        }
        await savePublicDoc(task.id, {
            resultImageA: task.resultImageA || null, resultImageB: task.resultImageB || null,
            status: task.status, remark: task.remark || ''
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/retry/:taskId', async (req, res) => {
    try {
        const task = await getTask(req.params.taskId, true);
        if (!task) return res.status(404).json({ success: false, error: '找不到該任務' });
        if (!task.sourceImage) return res.status(400).json({ success: false, error: '找不到原始照片' });
        Object.assign(task, {
            status: 'queued', remark: '', resultImageA: null, resultImageB: null,
            generationIdA: null, generationIdB: null
        });
        await savePublicDoc(task.id, {
            status: 'queued', remark: '', resultImageA: null, resultImageB: null,
            generationIdA: null, generationIdB: null
        });
        enqueueGeneration(task.id);
        res.json({ success: true, status: 'queued' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/reset-all', async (_req, res) => {
    try {
        if (activeGenerationJobs > 0) {
            return res.status(409).json({ success: false, error: `目前仍有${activeGenerationJobs}筆AI任務生成中，請完成後再重製排隊` });
        }
        localTasksCache = {};
        qrSessionsCache = {};
        generationQueue.splice(0, generationQueue.length);
        queuedTaskIds.clear();
        ticketCounter = 1;
        if (useFirebase) {
            const snapshot = await getDocs(collection(db, 'artifacts', appId, 'public'));
            const deletes = [];
            snapshot.forEach(item => {
                if (item.id !== '_config') deletes.push(deleteDoc(publicDoc(item.id)));
            });
            await Promise.all(deletes);
            await savePublicDoc('_counter', { type: 'counter', next: 1, updatedAt: nowIso() }, false);
        }
        res.json({ success: true, message: '所有任務與上傳工作階段已清空' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/update-meta/:taskId', async (req, res) => {
    try {
        const task = await getTask(req.params.taskId);
        if (!task) return res.status(404).json({ success: false, error: '找不到該任務' });
        const updates = {};
        if (req.body.processStatus !== undefined) updates.processStatus = task.processStatus = String(req.body.processStatus).slice(0, 30);
        if (req.body.remark !== undefined) updates.remark = task.remark = String(req.body.remark).slice(0, 500);
        await savePublicDoc(task.id, updates);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/admin/printer-status', async (_req, res) => {
    try {
        const data = await feieRequest('Open_queryPrinterStatus');
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/reprint/:taskId', async (req, res) => {
    try {
        const task = await getTask(req.params.taskId);
        if (!task) return res.status(404).json({ success: false, error: '找不到該任務' });
        const data = await triggerFeiePrint(task);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.use((error, _req, res, _next) => {
    console.error('未處理的伺服器錯誤:', error);
    if (error?.type === 'entity.too.large') return res.status(413).json({ success: false, error: '上傳資料過大' });
    res.status(500).json({ success: false, error: '伺服器發生錯誤' });
});

app.listen(PORT, () => {
    console.log(`🚀 PEYSON AI 後端運行中，PORT ${PORT}，AI同時任務數 ${MAX_CONCURRENT_JOBS}`);
});
