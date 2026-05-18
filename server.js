/**
 * AI互動雷雕拍照系統 - 專屬 LoRA 完全體後端
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
    res.status(200).send("🟢 專屬 LoRA 雷雕系統正常運行中");
});

app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: '未提供圖片資料' });
        
        // 雙重防呆金鑰檢查
        const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
        
        if (REPLICATE_API_TOKEN) {
            console.log("🚀 真正呼叫您的專屬 LoRA 模型 (cute-line-laser) 進行算圖...");
            
            // 🎯 這裡已經鎖死您的專屬模型 Version ID，絕對不會跑錯棚！
            const createRes = await axios.post('https://api.replicate.com/v1/predictions', {
                version: "33001ca5babe41c8aab61166a2b3442f575890edbde81a4c60dd2cf38d909c57", 
                input: {
                    image: image,
                    prompt: "A portrait of a person, TOK_CUTELINE, strictly monochrome, pure black and white line art, minimalist doodle, completely plain white background",
                    prompt_strength: 0.6, // 鎖定 0.6 保留特徵不變形
                    num_inference_steps: 28,
                    guidance_scale: 3.5,
                    output_format: "png"
                }
            }, {
                headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}`, 'Content-Type': 'application/json' }
            });

            const predictionUrl = createRes.data.urls.get;
            let isComplete = false;
            let finalImageUrl = null;

            console.log("⏳ 等待專屬 AI 算圖中...");
            while (!isComplete) {
                await new Promise(resolve => setTimeout(resolve, 1500));
                const checkRes = await axios.get(predictionUrl, { headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` } });
                const status = checkRes.data.status;
                if (status === 'succeeded') {
                    const output = checkRes.data.output;
                    finalImageUrl = Array.isArray(output) ? output[0] : output;
                    isComplete = true;
                } else if (status === 'failed' || status === 'canceled') {
                    throw new Error('Replicate 遠端處理失敗');
                }
            }

            console.log("🎨 專屬 AI 繪圖完成，啟動 Sharp 終極洗白...");
            
            const imgResponse = await axios.get(finalImageUrl, { responseType: 'arraybuffer' });
            const processedBuffer = await sharp(imgResponse.data)
                .greyscale() 
                .threshold(180) 
                .toBuffer();

            const base64Img = "data:image/png;base64," + processedBuffer.toString('base64');
            
            console.log("✅ 專屬黑白線稿已送出！");
            return res.status(200).json({ success: true, result: base64Img });

        } else {
            console.warn("⚠️ 未設定 REPLICATE_API_TOKEN，將回傳原圖");
            return res.status(200).json({ success: true, result: image });
        }

    } catch (error) {
        console.error("❌ 處理失敗:", error.response ? JSON.stringify(error.response.data) : error.message);
        return res.status(500).json({ error: '生成失敗' });
    }
});

app.listen(PORT, () => console.log(`🚀 伺服器啟動於 PORT: ${PORT}`));
