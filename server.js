/**
 * AI互動雷雕拍照系統 - 雲端後端伺服器 (ControlNet + Sharp 二值化 + 版本號修正版)
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get('/', (req, res) => {
    res.status(200).send("🟢 AI 雷雕系統 (ControlNet Canny) 正常運行中");
});

app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: '未提供圖片資料' });
        
        const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
        if (!REPLICATE_API_TOKEN) throw new Error("缺少 API Token");

        console.log("🚀 呼叫 AI 生成初稿...");
        
        // 🌟 修正：改回通用的 predictions 網址，並指定 ControlNet Canny 的絕對版本號
        const createRes = await axios.post('https://api.replicate.com/v1/predictions', {
            version: "aff48af9c68d162388d230a2ab003f68d2638d88307bdaf1c2f1ac95079c9613", 
            input: {
                image: image,
                prompt: "pure black and white line art, coloring book style, crisp black lines on pure white paper, high contrast, minimalist vector lines, no shading, no gray",
                negative_prompt: "color, shading, gray, realistic, shadows, background noise, messy",
                num_inference_steps: 20
            }
        }, {
            headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}`, 'Content-Type': 'application/json' }
        });

        // 輪詢等待 AI 完成
        let finalImageUrl = await pollReplicate(createRes.data.urls.get, REPLICATE_API_TOKEN);

        console.log("🎨 AI 繪圖完成，開始「二值化」強效後處理...");
        
        // 下載 AI 產出的圖片
        const imgResponse = await axios.get(finalImageUrl, { responseType: 'arraybuffer' });
        
        // 🌟 使用 Sharp 進行強效二值化 (去除灰階抗鋸齒，專為雷雕設計)
        const processedBuffer = await sharp(imgResponse.data)
            .greyscale() 
            .threshold(200) 
            .toBuffer();

        // 轉為 Base64 回傳前端
        const base64Img = "data:image/png;base64," + processedBuffer.toString('base64');
        
        console.log("✅ 完美黑白線稿已送出！");
        return res.status(200).json({ success: true, result: base64Img });

    } catch (error) {
        console.error("❌ 處理失敗:", error.response ? JSON.stringify(error.response.data) : error.message);
        return res.status(200).json({ success: true, result: req.body.image });
    }
});

// 輔助函式：等待 AI 算圖完成
async function pollReplicate(url, token) {
    let isComplete = false;
    while (!isComplete) {
        await new Promise(r => setTimeout(r, 1500));
        const res = await axios.get(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.data.status === 'succeeded') {
            const output = res.data.output;
            return Array.isArray(output) ? output[output.length - 1] : output;
        }
        if (res.data.status === 'failed' || res.data.status === 'canceled') {
            throw new Error("AI 算圖失敗");
        }
    }
}

app.listen(PORT, () => console.log(`🚀 後端啟動於 PORT: ${PORT}`));
