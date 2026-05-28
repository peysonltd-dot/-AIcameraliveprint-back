/**
 * AI 互動雷雕拍照系統 - 後端 API (雙風格二選一完全體版)
 * 核心功能：
 * 1. 支援後台管理員同時上傳雙重 AI 風格圖 (resultImageA / resultImageB)
 * 2. 支援前端使用者互動二選一，並將客人的最終抉擇 (chosenDesign) 存回後台
 * 3. 採用安全免條約之 LLaVA 13B 視覺大腦，徹底避開 404 限制。
 */
const express = require('express');
const cors = require('cors');
const Replicate = require('replicate');

const app = express();
const PORT = process.env.PORT || 10000; 

const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN || "", 
});

app.use(cors());
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ limit: '60mb', extended: true }));

const tasks = {};
let ticketCounter = 1;

app.get('/', (req, res) => {
    res.status(200).send("🟢 Queue Server (Dual-Style Choice Engine) is active.");
});

// 1. 客人拍照上傳
app.post('/api/upload', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: '未提供圖片資料' });

        const taskId = String(ticketCounter).padStart(3, '0');
        ticketCounter++;

        let fallbackPrompt = `Quirky minimalist hand-drawn doodle portrait, naive art, chibi kawaii aesthetic. Extreme chibi proportions, huge oversized head, tiny small body, narrow sloping shoulders. Extremely simplified facial features, simple vertical dot eyes, tiny line nose, soft blurred pink blush on cheeks. Clean simple neck, wearing a basic round neck t-shirt. Drawn with a monoline marker brush. Flat soft colors. Solid pure white background, no shading.`;

        tasks[taskId] = {
            id: taskId,
            sourceImage: image, 
            status: 'pending',  
            resultImageA: null,   // 風格 A
            resultImageB: null,   // 風格 B
            chosenDesign: null,   // 客人選哪張 (A 或是 B)
            remark: '',         
            suggestedPrompt: fallbackPrompt, 
            // 🌟 核心修正：強制指定為台北時區，確保顯示台灣時間
            createdAt: new Date().toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) 
        };

        console.log(`🎫 新任務建立：排隊號碼 #${taskId}`);
        res.json({ success: true, taskId: taskId });

        if (process.env.REPLICATE_API_TOKEN) {
            analyzeImageAndGeneratePrompt(taskId, image);
        }
    } catch (error) {
        res.status(500).json({ error: '伺服器錯誤' });
    }
});

// 2. 輪詢查詢狀態 (讓前端知道有沒有雙圖了，並回傳客人選了哪張)
app.get('/api/status/:taskId', (req, res) => {
    const taskId = req.params.taskId;
    const task = tasks[taskId];
    if (!task) return res.status(404).json({ error: '找不到該號碼任務' });

    res.json({ 
        success: true, 
        status: task.status, 
        resultImageA: task.resultImageA,
        resultImageB: task.resultImageB,
        chosenDesign: task.chosenDesign
    });
});

// 3. 客人點選了某一風格，回傳給後台紀錄
app.post('/api/choice/:taskId', (req, res) => {
    const taskId = req.params.taskId;
    const { choice } = req.body; // 'A' 或是 'B'
    const task = tasks[taskId];
    if (!task) return res.status(404).json({ error: '找不到該任務' });

    task.chosenDesign = choice;
    console.log(`🎯 號碼牌 #${taskId} 客人最終選擇了風格：[${choice} 款]`);
    res.json({ success: true });
});

// 4. 工作人員獲取所有數據
app.get('/api/admin/all-tasks', (req, res) => {
    const all = Object.values(tasks).sort((a, b) => a.id.localeCompare(b.id));
    res.json({ success: true, tasks: all });
});

// 5. 工作人員上傳風格 A 或風格 B 的結果圖
app.post('/api/admin/upload-result-dual/:taskId', (req, res) => {
    const taskId = req.params.taskId;
    const { resultImageA, resultImageB } = req.body;
    const task = tasks[taskId];
    if (!task) return res.status(404).json({ error: '找不到該任務' });

    if (resultImageA) task.resultImageA = resultImageA;
    if (resultImageB) task.resultImageB = resultImageB;

    // 當兩張圖都被齊全上傳時，正式將狀態推進為 completed
    if (task.resultImageA && task.resultImageA !== "" && task.resultImageB && task.resultImageB !== "") {
        task.status = 'completed';
        console.log(`✅ 任務完成：號碼 #${task.id} 的雙重風格圖皆已成功上傳到位！`);
    }

    res.json({ success: true });
});

// LLaVA 13B 視覺解析
async function analyzeImageAndGeneratePrompt(taskId, base64Image) {
    try {
        const promptText = `
        You are a highly precise visual analysis assistant. Output ONLY a JSON block inside curly braces, containing these exact attributes:
        {
          "gender": "man, woman, boy, or girl",
          "hairLength": "short (above shoulders), shoulder-length, or long (past shoulders)",
          "hairTexture": "straight, wavy, or curly",
          "hairStyle": "messy bun, ponytail, princess, braids, loose hair",
          "hairParting": "center-parted, side-parted, or no parting",
          "bangs": "wispy bangs, side-swept bangs, blunt bangs, or no bangs",
          "hairColor": "black, dark brown, chestnut brown, blonde, dyed pink, dyed purple, or silver grey",
          "glasses": "wearing glasses, or no glasses",
          "necklace": "wearing necklace, or no necklace",
          "earrings": "wearing earrings, or no earrings",
          "clothingColor": "black, white, red, blue, green, yellow, pink, or grey"
        }
        Output raw JSON directly. Do not wrap in markdown tags.
        `;

        let rawText = "";
        for await (const event of replicate.stream(
            "yorickvp/llava-13b:80537f9eead1a5bfa72d5ac6ea6414379be41d4d4f6679fd776e9535d1eb58bb",
            { input: { image: base64Image, prompt: promptText.trim() } }
        )) {
            rawText += event;
        }

        let cleanText = rawText.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("無效JSON物件");

        const f = JSON.parse(jsonMatch[0]);
        let bangsText = f.bangs === 'no bangs' ? 'no bangs' : `${f.bangs}`;
        if (f.hairParting && f.hairParting !== 'no parting') bangsText += ` with a ${f.hairParting}`;

        const customPrompt = `Quirky minimalist hand-drawn doodle portrait of a ${f.gender || 'person'} with long straight ${f.hairColor || 'black'} hair styled in a ${f.hairStyle || 'loose hair'} with ${bangsText}, showing a smiling. The person is ${f.glasses || 'no glasses'}, ${f.necklace || 'no necklace'}, and ${f.earrings || 'no earrings'}. Wearing a plain unpatterned solid ${f.clothingColor || 'white'} t-shirt, absolutely no logos, no graphics, no text on shirt. Naive art, chibi kawaii aesthetic. Extreme chibi proportions, huge oversized head, tiny small body, narrow sloping shoulders. Extremely simplified facial features, simple vertical black dot eyes, tiny line nose, soft blurred pink blush on cheeks. Smooth clean bare neck, absolutely no neck lines. Clean solid color hair, no white dots, no shading. Drawn with a monoline marker brush. Flat soft colors. Solid pure white background.`;

        if (tasks[taskId]) tasks[taskId].suggestedPrompt = customPrompt;
    } catch (err) {
        console.error(`❌ 號碼 #${taskId} LLaVA 錯誤:`, err.message);
    }
}

app.listen(PORT, () => {
    console.log(`🚀 雙重風格叫號伺服器運行中，監聽 PORT: ${PORT}`);
});
