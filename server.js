/**
 * AI互動雷雕拍照系統 - 雲端後端伺服器 (雙階段 AI Pipeline 版本)
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 🌟 可選：如果您還想保留那張美女圖的畫風參考，請保留這個網址
const STYLE_REF_URL = "https://raw.githubusercontent.com/peysonltd-dot/AIcameraliveprint/main/style.jpg.jpg";

// ==========================================
// 🛠️ 核心工具：通用 AI 呼叫函數 (方便串聯任務)
// ==========================================
async function callReplicateAI(modelPath, inputParams, token) {
    const createRes = await axios.post(`https://api.replicate.com/v1/models/${modelPath}/predictions`, {
        input: inputParams
    }, {
        headers: { 
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    const predictionUrl = createRes.data.urls.get;
    
    while (true) {
        await new Promise(resolve => setTimeout(resolve, 1500)); // 每 1.5 秒問一次進度
        const checkRes = await axios.get(predictionUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const status = checkRes.data.status;
        if (status === 'succeeded') {
            return checkRes.data.output; // 回傳算好的圖片網址
        } else if (status === 'failed' || status === 'canceled') {
            throw new Error(checkRes.data.error);
        }
    }
}

app.get('/', (req, res) => {
    res.status(200).send("🟢 AI 雷雕系統 (雙階段 Pipeline) 正常運行中");
});

app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body; 

        if (!image) return res.status(400).json({ error: '未提供圖片資料' });
        console.log("📥 [請求到達] 收到新的影像處理請求");

        const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

        if (!REPLICATE_API_TOKEN) {
            console.log("⚠️ 未偵測到 API Token，退回原圖");
            return res.status(200).json({ success: true, result: image });
        }

        // ==========================================
        // 🚀 階段一：藝術風格化 (卡通/一筆畫風格)
        // ==========================================
        console.log("⏳ [階段 1/2] 正在將照片轉換為藝術風格...");
        const step1Input = {
            prompt: "Transform this photo into a flat vector illustration, continuous line art style, simple and elegant cartoon style. Clean edges, minimalist details, pure white background. Keep the person's exact identity and facial features.",
            // 將遊客照片與您的風格圖一起丟進去融合
            image_input: [image, STYLE_REF_URL], 
            aspect_ratio: "match_input_image",
            output_format: "jpg"
        };
        const styleImageUrl = await callReplicateAI('google/nano-banana-2', step1Input, REPLICATE_API_TOKEN);
        console.log("✅ 階段一完成！暫存網址:", styleImageUrl);

        // ==========================================
        // 🚀 階段二：強制轉換純黑白線稿 (拔除所有顏色)
        // ==========================================
        console.log("⏳ [階段 2/2] 正在萃取純黑白線稿...");
        const step2Input = {
            prompt: "Convert this exact image into a pure black and white coloring book illustration. Use ONLY solid black ink lines. ZERO color, ZERO shading, ZERO gray tones. Pure white background. DO NOT add any new details.",
            // 這裡最關鍵：把「第一階段算出來的圖片網址」當作這回合的輸入！
            image_input: [styleImageUrl], 
            aspect_ratio: "match_input_image",
            output_format: "jpg"
        };
        const finalImageUrl = await callReplicateAI('google/nano-banana-2', step2Input, REPLICATE_API_TOKEN);
        console.log("✅ 階段二完成！取得最終線稿網址:", finalImageUrl);


        // ==========================================
        // 📦 打包回傳給前端
        // ==========================================
        console.log("📥 正在下載並轉換最終圖片格式...");
        const imgResponse = await axios.get(finalImageUrl, { responseType: 'arraybuffer' });
        const base64Img = "data:image/jpeg;base64," + Buffer.from(imgResponse.data, 'binary').toString('base64');

        console.log("🎉 任務完美結束，回傳給前端！");
        return res.status(200).json({ success: true, result: base64Img });

    } catch (error) {
        console.error("❌ 伺服器錯誤:", error.message);
        // 保命機制：如果任何一個階段出錯，就退回原圖，避免畫面卡死
        return res.status(200).json({ success: true, result: req.body.image });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 雙階段後端已啟動於 PORT: ${PORT}`);
});
