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
require('./event-access')(app);

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
    localTasksCache[taskId] = { ...task };
    if (['completed', 'failed'].includes(task.status)) delete localTasksCache[taskId].sourceImage;
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
        signal: AbortSignal.timeout(45000), method: 'POST',
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

    const uploadResponse = await fetch(init.url, { method: 'POST', body: formData, signal: AbortSignal.timeout(60000) });
    if (!uploadResponse.ok) throw new Error(`Leonardo S3照片上傳失敗: ${uploadResponse.status}`);
    return init.id;
}

async function requestLeonardoGeneration(model, styleId, prompt, guestImageId) {
    const response = await fetch('https://cloud.leonardo.ai/api/rest/v2/generations', {
        signal: AbortSignal.timeout(60000), method: 'POST',
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
        signal: AbortSignal.timeout(15000), headers: { authorization: `Bearer ${LEONARDO_API_KEY}` }
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

async function feieRequestRaw(apiname, extra = {}) {
    const user = (process.env.FEIE_USER || '').trim();
    const ukey = (process.env.FEIE_UKEY || '').trim();
    const sn = (process.env.FEIE_SN || '961820398').trim();
    if (!user || !ukey) throw new Error('Render尚未設定飛鵝出票機帳號');

    const stime = Math.floor(Date.now() / 1000);
    const sig = crypto.createHash('sha1').update(user + ukey + stime).digest('hex');
    const params = new URLSearchParams({ user, stime: String(stime), sig, apiname, sn, ...extra });
    const response = await fetch('https://api.jp.feieyun.com/Api/Open/', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params,
        signal: AbortSignal.timeout(15000)
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { throw new Error('出票機回應無法確認，請核對實機後再補印'); }
    if (!response.ok || data.ret !== 0) throw new Error(data.msg || `出票機服務錯誤 (${response.status})`);
    return data;
}

// Serialize print/clear operations for the configured device. Never retry uncertain prints automatically.
let printerQueue = Promise.resolve();
function feieRequest(apiname, extra = {}) {
    if (!['Open_printMsg', 'Open_delPrinterSqs'].includes(apiname)) return feieRequestRaw(apiname, extra);
    const job = printerQueue.then(() => feieRequestRaw(apiname, extra));
    printerQueue = job.catch(() => undefined);
    return job;
}
async function recordTicket(task) {
    try {
        const data = await triggerFeiePrint(task);
        Object.assign(task, { ticketStatus: 'accepted', ticketOrderId: data.data || null });
    } catch (error) {
        Object.assign(task, { ticketStatus: 'unconfirmed', ticketError: '出票未確認，請核對實機後再補印' });
        console.error(`出票 #${task.id} 未確認:`, error.message);
    }
    await savePublicDoc(task.id, { ticketStatus: task.ticketStatus, ticketOrderId: task.ticketOrderId || null }).catch(error => console.error('出票狀態儲存失敗:', error.message));
}
const choiceJobs = new Map();
async function confirmChoice(taskId, choice) {
    if (choiceJobs.has(taskId)) return choiceJobs.get(taskId);
    const job = (async () => {
        const task = await getTask(taskId);
        if (!task) throw new Error('找不到該任務');
        if (task.chosenDesign) return { success: true, chosenDesign: task.chosenDesign, reused: true };
        if (task.status !== 'completed' || !task[`resultImage${choice}`]) throw new Error('圖片尚未準備完成');
        // Persist before acknowledging; retries reuse the choice and do not print again.
        await savePublicDoc(task.id, { chosenDesign: choice, submittedAt: nowIso(), ticketStatus: 'pending' });
        task.chosenDesign = choice;
        task.ticketStatus = 'pending';
        void recordTicket(task);
        return { success: true, chosenDesign: choice };
    })();
    choiceJobs.set(taskId, job);
    try { return await job; } finally { choiceJobs.delete(taskId); }
}

async function triggerFeiePrint(task) {
    const content = [
        '<C>解鎖AI實踐力</C><BR>',
        '<C>live print</C><BR>',
        `<CB>${task.id}</CB><BR>`,
        '<C>領取時請出示此號碼牌</C><BR>',
        '<C>～祝您體驗愉快～</C><BR>'
    ].join('');
    return feieRequest('Open_printMsg', { content, times: '1' });
}

// Standalone photo download page: no redirect to the kiosk domain.
const portraitDownloadPage = "<!DOCTYPE html>\n<html lang=\"zh-TW\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <meta name=\"color-scheme\" content=\"light\">\n  <meta name=\"robots\" content=\"noindex,nofollow\">\n  <meta name=\"peyson-version\" content=\"innoserve-download-v2\">\n  <title>角色圖片下載 | AI 人像體驗</title>\n  <style>\n    :root { color-scheme:light; --ink:#243c35; --muted:#63736e; --green:#26705b; --line:#dce6e1; }\n    * { box-sizing:border-box; }\n    body { margin:0; background:#fff; color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"Noto Sans TC\",\"Noto Sans JP\",\"Microsoft JhengHei\",sans-serif; line-height:1.6; }\n    .page { width:min(100%,480px); min-height:100vh; min-height:100dvh; margin:0 auto; padding:32px 20px 24px; padding-bottom:max(24px,env(safe-area-inset-bottom)); }\n    .page-header { text-align:center; margin:0 0 24px; }\n    .experience-title { margin:0; font-size:clamp(21px,5.5vw,27px); font-weight:750; letter-spacing:.12em; }\n    .experience-en { display:block; margin-top:5px; color:var(--muted); font-size:10px; letter-spacing:.17em; }\n    .header-rule { width:32px; height:3px; border-radius:4px; background:#b4cec1; margin:20px auto 16px; }\n    h1 { margin:0; font-size:clamp(20px,5.5vw,25px); font-weight:700; letter-spacing:.06em; }\n    .subtitle { margin:4px 0 0; font-size:12px; color:var(--muted); }\n    .portrait-card { padding:24px clamp(16px,5vw,28px); border:1px solid var(--line); border-radius:24px; background:#fff; text-align:center; box-shadow:0 10px 32px #243c3507; }\n    .number-label { display:block; color:var(--muted); font-size:10px; letter-spacing:.18em; }\n    .number { display:block; color:var(--green); font-size:clamp(34px,10vw,44px); font-weight:750; font-variant-numeric:tabular-nums; line-height:1.25; margin:3px 0 20px; }\n    .portrait-stage { position:relative; width:100%; aspect-ratio:1; border:1px solid #e8eeeb; border-radius:18px; overflow:hidden; background:#fafcfb; display:flex; align-items:center; justify-content:center; }\n    #portrait-img { display:block; width:100%; height:100%; object-fit:contain; }\n    #loading-spinner { position:absolute; inset:0; padding:16px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; font-size:13px; color:var(--muted); }\n    #spinner-text-en { font-size:11px; }\n    .save-guide { margin:22px 0 18px; }\n    #guide-text-1 { font-weight:650; font-size:15px; margin:0 0 6px; color:var(--green); }\n    #guide-text-2 { font-size:12px; margin:0; color:var(--muted); overflow-wrap:anywhere; }\n    .device-note { color:#7e8b85; font-size:10px; margin:7px 0 0; }\n    #download-btn { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; width:100%; min-height:66px; padding:13px 16px; border:0; border-radius:15px; background:var(--green); color:white; font:inherit; font-size:18px; font-weight:700; cursor:pointer; touch-action:manipulation; }\n    #download-btn:not(:disabled):hover { background:#1c5b48; }\n    #download-btn:not(:disabled):active { transform:translateY(1px); }\n    #download-btn:focus-visible { outline:3px solid #81b3a1; outline-offset:4px; }\n    #download-btn:disabled { background:#e4ebe7; color:#84938c; cursor:not-allowed; }\n    .button-en { font-size:10px; font-weight:500; letter-spacing:.15em; opacity:.85; }\n    .page-footer { text-align:center; margin-top:30px; }\n    .medical-partners { display:grid; grid-template-columns:1.55fr 1fr 1fr; gap:18px; align-items:center; width:100%; padding:18px 0 22px; border-bottom:1px solid #edf1ee; }\n    .medical-partners img { display:block; width:100%; height:clamp(50px,15vw,70px); object-fit:contain; }\n    .credit { margin:18px 0 4px; color:var(--muted); font-size:11px; letter-spacing:.1em; }\n    .copyright { margin:0; color:#8a968f; font-size:9px; letter-spacing:.06em; }\n    .hidden,[hidden] { display:none !important; }\n    .fa-solid { display:inline-block; font-style:normal; }\n    .fa-download::before { content:\"↓\"; margin-right:7px; font-size:1.1em; }\n    .fa-hand-pointer::before { content:\"☝\"; margin-right:5px; }\n    .fa-triangle-exclamation::before { content:\"!\"; display:inline-grid; place-items:center; border:1px solid currentColor; border-radius:50%; width:28px; height:28px; font-weight:700; }\n    .fa-spinner { width:28px; height:28px; border:3px solid #dce6e1; border-top-color:var(--green); border-radius:50%; margin-bottom:5px; animation:spin 1s linear infinite; }\n    .text-rose-400,.text-rose-500 { color:#9a4848; }\n    @keyframes spin { to { transform:rotate(360deg); } }\n    @media(prefers-reduced-motion:reduce) { .fa-spinner { animation:none; } }\n    @media(max-width:350px) { .page { padding:24px 14px; }.medical-partners { gap:12px; } }\n  \n/* Updated event artwork, kept at the supplied aspect ratios. */\n.event-brand{display:flex;flex-direction:row;align-items:center;gap:clamp(8px,2vw,20px);width:100%;background:#fff}\n.event-brand img.event-brand-logo{display:block;flex:0 0 20%;width:20%;max-width:180px;height:auto;margin:0;object-fit:contain}\n.event-brand .event-brand-title{flex:1 1 0;min-width:0;width:auto;padding:0;background:#fff;box-sizing:border-box;border-radius:4px}\n.event-brand .event-brand-title img{display:block;width:100%;height:auto;margin:0;object-fit:contain}\n.screenshot-note{color:#f5da69!important;white-space:nowrap}\n@media(max-width:600px){.event-brand{gap:8px}.event-brand .event-brand-title{padding:0}.event-brand img.event-brand-logo{width:20%}}\n\n.page-header>.event-brand{padding:18px;border:2px solid #f5da69;border-radius:18px;margin-bottom:24px;box-sizing:border-box}\n\n.event-brand.unlock-brand{display:flex;flex-direction:column;gap:0;width:100%;background:#fff}\n.event-brand.unlock-brand img{display:block;width:100%;max-width:none;height:auto;flex:none;object-fit:contain}\n</style>\n<style>\nbody{background:#133139;color:#fff}.event-logo{width:100%;height:auto;border-radius:12px;margin:0 0 24px}.page-header h1,.page-header p{color:#fff}.header-rule{background:#f5da69}.portrait-card{color:#17363e;border:2px solid #f5da69}#download-btn{background:#f5da69;color:#17363e}#download-btn:not(:disabled):hover{background:#ffe998}.medical-partners{grid-template-columns:repeat(3,minmax(0,1fr));background:#fff;border-radius:12px;padding:16px 12px;gap:12px;box-sizing:border-box}.medical-partners img{height:60px;width:100%;object-fit:contain}\n\n.event-brand.unlock-brand{display:flex;flex-direction:column;gap:0;width:100%;background:#fff}\n.event-brand.unlock-brand img{display:block;width:100%;max-width:none;height:auto;flex:none;object-fit:contain}\n</style></head>\n<body>\n  <div class=\"page\">\n    <header class=\"page-header\"><div class=\"event-brand unlock-brand\"><img class=\"unlock-title\" src=\"https://photo.peysonliveprint.com/assets/unlock-ai/title.jpg\" alt=\"解鎖AI實踐力 育見AI新世代\" /><img class=\"unlock-subtitle\" src=\"https://photo.peysonliveprint.com/assets/unlock-ai/subtitle.jpg\" alt=\"2026 Artificial Intelligence (AI) Teaching Practice Project\" /></div>\n      <p class=\"experience-title\">AI 人像體驗</p>\n      <span class=\"experience-en\">AI PORTRAIT EXPERIENCE</span>\n      <div class=\"header-rule\" aria-hidden=\"true\"></div>\n      <h1 id=\"header-title\">角色圖片下載</h1>\n      <p class=\"subtitle\">Save Your Picture</p>\n    </header>\n    <main>\n      <section class=\"portrait-card\" aria-labelledby=\"header-title\">\n        <span class=\"number-label\">YOUR NUMBER</span>\n        <span id=\"display-task-id\" class=\"number\">#---</span>\n        <div class=\"portrait-stage\">\n          <div id=\"loading-spinner\" role=\"status\" aria-live=\"polite\">\n            <i class=\"fa-solid fa-spinner\" aria-hidden=\"true\"></i>\n            <span id=\"spinner-text-zh\">正在載入您的角色圖片…</span>\n            <span id=\"spinner-text-en\">Loading your picture…</span>\n          </div>\n          <img id=\"portrait-img\" class=\"hidden\" alt=\"AI Character\" />\n        </div>\n        <div class=\"save-guide\">\n          <p id=\"guide-text-1\">長按上方圖片即可儲存</p>\n          <p id=\"guide-text-2\">Touch and hold the picture to save it / 画像を長押しして保存</p>\n          <p class=\"device-note\">iOS (Safari/LINE/WeChat) &amp; Android</p>\n        </div>\n        <button id=\"download-btn\" type=\"button\" disabled>\n          <span id=\"btn-text-main\"><i class=\"fa-solid fa-download\" aria-hidden=\"true\"></i>一鍵下載檔案</span>\n          <span class=\"button-en\">SAVE PICTURE</span>\n        </button>\n      </section>\n    </main>\n    <footer class=\"page-footer\">\n      \n      <p class=\"credit\">PEYSON LIVE PRINT</p>\n      <p class=\"copyright\">2026 ALL RIGHTS RESERVED</p>\n    </footer>\n  </div>\n  <script>\n        const API_BASE_URL = \"https://aicameraliveprint-back.onrender.com\";\n        let loadAttempts = 0;\n\n        const urlParams = new URLSearchParams(window.location.search);\n        const taskId = urlParams.get('taskId');\n        const langParam = urlParams.get('lang');\n\n        // 自動檢測手機語系是否為日文\n        const isJapanese = false;\n        const isEnglish = langParam ? langParam === 'en' : navigator.language.startsWith('en');\n        if (isEnglish) {\n            document.documentElement.lang = 'en';\n            document.getElementById('header-title').innerText = 'Save Your Picture';\n            document.getElementById('spinner-text-zh').innerText = 'Loading your picture…';\n            document.getElementById('spinner-text-en').hidden = true;\n            document.getElementById('guide-text-1').innerText = 'Touch and hold the picture to save it.';\n            document.getElementById('guide-text-2').innerText = 'Or tap the button below.';\n            document.getElementById('btn-text-main').innerText = 'Save Picture';\n        }\n\n        if (isJapanese) {\n            document.documentElement.lang = \"ja\";\n            document.getElementById('spinner-text-en').hidden = true;\n            document.getElementById('guide-text-2').innerText = \"下のボタンからも保存できます。\";\n            document.getElementById('header-title').innerText = \"キャラクターを保存\";\n            document.getElementById('spinner-text-zh').innerText = \"キャラクターを読み込んでいます…\";\n            document.getElementById('guide-text-1').innerHTML = `<i class=\"fa-solid fa-hand-pointer mr-1 animate-bounce\"></i> 上の画像を長押しして保存`;\n            document.getElementById('btn-text-main').innerHTML = `<i class=\"fa-solid fa-download mr-1.5\"></i> 画像を保存する`;\n        }\n\n        const displayIdEl = document.getElementById('display-task-id');\n        const portraitImg = document.getElementById('portrait-img');\n        const spinner = document.getElementById('loading-spinner');\n        const downloadBtn = document.getElementById('download-btn');\n\n        if (taskId && /^\\d{1,12}$/.test(taskId)) {\n            displayIdEl.innerText = `#${taskId}`;\n            fetchPortraitData();\n        } else {\n            displayIdEl.innerText = \"#ERROR\";\n            spinner.innerHTML = `\n                <i class=\"fa-solid fa-triangle-exclamation text-3xl text-rose-500\"></i>\n                <span class=\"text-xs text-rose-400 mt-2 font-bold\">${isEnglish ? 'This link is not valid. Please scan the QR code again.' : isJapanese ? 'このリンクは使えません。QRコードをもう一度読み取ってください。' : '網址無效：查無此序號'}</span>\n                <span class=\"text-[10px] text-rose-400 font-mono mt-0.5\">Invalid URL / 番号が見つかりません</span>\n            `;\n        }\n\n        async function fetchPortraitData() {\n            try {\n                loadAttempts += 1;\n                const res = await fetch(`${API_BASE_URL}/api/status/${encodeURIComponent(taskId)}`, {cache: \"no-store\"});\n                if (!res.ok) throw new Error(\"HTTP \" + res.status);\n                const data = await res.json();\n\n                if (data.success && data.chosenDesign) {\n                    const finalImage = data.chosenDesign === 'A' ? data.resultImageA : data.resultImageB;\n\n                    if (finalImage) {\n                        portraitImg.src = `${API_BASE_URL}/api/image/${encodeURIComponent(taskId)}/${data.chosenDesign}`;\n                        portraitImg.classList.remove('hidden');\n                        spinner.classList.add('hidden');\n\n                        downloadBtn.disabled = false;\n                        downloadBtn.classList.remove('opacity-50', 'cursor-not-allowed');\n\n                        downloadBtn.addEventListener('click', async () => {\n                            try {\n                                const response = await fetch(`${API_BASE_URL}/api/image/${encodeURIComponent(taskId)}/${data.chosenDesign}`);\n                                if (!response.ok) throw new Error('圖片下載失敗');\n                                const blob = await response.blob();\n                                const blobUrl = window.URL.createObjectURL(blob);\n                                const a = document.createElement('a');\n                                a.style.display = 'none';\n                                a.href = blobUrl;\n                                a.download = `Portrait_${taskId}.${blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'}`;\n                                document.body.appendChild(a);\n                                a.click();\n                                window.URL.revokeObjectURL(blobUrl);\n                                document.body.removeChild(a);\n                            } catch (e) {\n                                window.open(finalImage, '_blank');\n                            }\n                        });\n                    } else {\n                        throw new Error(\"圖片尚未生成完畢\");\n                    }\n                } else {\n                    throw new Error(\"找不到對應的風格或選擇\");\n                }\n            } catch (err) {\n                console.error(\"下載頁讀取失敗，3秒後自動重新嘗試...\", err);\n                if (loadAttempts < 3) { setTimeout(fetchPortraitData, 3000); }\n                else {\n                    spinner.textContent = isEnglish ? 'Unable to load. Please reload or ask our staff.' : isJapanese ? '読み込めません。再読み込みするかスタッフにお尋ねください。' : '暫時無法載入，請重新整理或洽現場人員。';\n                }\n            }\n        }\n    </script>\n</body>\n</html>\n\n";
app.get('/download.html', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.type('html').send(portraitDownloadPage);
});

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

require('./portrait-preview').installPortraitPreview(app, getTask);

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
        res.json(await confirmChoice(req.params.taskId, choice));
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
    res.setHeader('Cache-Control', req.query.lightweight === 'true' ? 'private, max-age=0, must-revalidate' : 'no-store');
    const all = Object.values(localTasksCache)
        .filter(task => task?.type !== 'uploadSession')
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));

    if (req.query.lightweight === 'true') {
        const tasks = all.map(task => {
            const item = {};
            for (const field of ['id','entryMode','status','chosenDesign','processStatus','remark','createdAt','createdAtIso','guestCode','ticketStatus']) {
                if (task[field] !== undefined) item[field] = task[field];
            }
            item.hasSourceImage = !!task.sourceImage || !!task.sourceStored;
            item.hasResultImageA = !!task.resultImageA;
            item.hasResultImageB = !!task.resultImageB;

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

app.post('/api/admin/printer-clear-queue', async (req, res) => {
    if (req.body?.confirm !== 'CLEAR_PENDING_TICKETS') return res.status(400).json({ success: false, error: '請先確認清除待印小票' });
    try {
        const data = await feieRequest('Open_delPrinterSqs');
        if (data.data !== true) throw new Error('清除結果未確認，請檢查出票機狀態');
        res.json({ success: true, message: '已清除目前出票機的待印小票，系統訂單保留' });
    } catch (error) { res.status(502).json({ success: false, error: error.message }); }
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






