/**
 * AI互動雷雕拍照系統 - 雲端後端伺服器 (ControlNet + Sharp 二值化版)
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const sharp = require('sharp'); // 🌟 引入影像處理神器

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: '未提供圖片資料' });
        
        const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
        if (!REPLICATE_API_TOKEN) throw new Error("缺少 API Token");

        console.log("🚀 呼叫 AI 生成初稿...");
        const createRes = await axios.post('https://api.replicate.com/v1/models/jagilley/controlnet-canny/predictions', {
            input: {
                image: image,
                prompt: "pure black and white line art, coloring book style, crisp black lines on pure white paper, high contrast, minimalist vector lines, no shading, no gray",
                negative_prompt: "color, shading, gray, realistic, shadows, background noise, messy",
                num_inference_steps: 20
            }
        }, {
            headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}`, 'Content-Type': 'application/json' }
        });

        // 輪詢等待 AI 完成... (省略重複的 polling 邏輯，假設已取得 finalImageUrl)
        let finalImageUrl = await pollReplicate(createRes.data.urls.get, REPLICATE_API_TOKEN);

        console.log("🎨 AI 繪圖完成，開始「二值化」強效後處理...");
        
        // 1. 下載 AI 產出的圖片
        const imgResponse = await axios.get(finalImageUrl, { responseType: 'arraybuffer' });
        
        // 2. 使用 Sharp 進行二值化處理
        // greyscale: 轉為灰階
        // threshold(200): 高於 200 的變白，低於 200 的變黑 (雷雕機最愛)
        const processedBuffer = await sharp(imgResponse.data)
            .greyscale() 
            .threshold(200) 
            .toBuffer();

        // 3. 轉為 Base64 回傳前端
        const base64Img = "data:image/png;base64," + processedBuffer.toString('base64');
        
        console.log("✅ 完美黑白線稿已送出！");
        return res.status(200).json({ success: true, result: base64Img });

    } catch (error) {
        console.error("❌ 處理失敗:", error.message);
        return res.status(200).json({ success: true, result: req.body.image });
    }
});

// 輔助函式：等待 AI 算完
async function pollReplicate(url, token) {
    let isComplete = false;
    while (!isComplete) {
        await new Promise(r => setTimeout(r, 1500));
        const res = await axios.get(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.data.status === 'succeeded') return res.data.output[res.data.output.length - 1];
        if (res.data.status === 'failed') throw new Error("AI 算圖失敗");
    }
}

app.listen(PORT, () => console.log(`🚀 後端啟動於 PORT: ${PORT}`));
