/**
 * AI互動雷雕拍照系統 - 封神上線版 (抽乾顏色、強制洗白完全體)
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
    res.status(200).send("🟢 專屬 LoRA 雷雕系統 (封神版) 正常運行中");
});

app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: '未提供圖片資料' });
        
        // 雙重防呆金鑰檢查
        const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
        
        if (REPLICATE_API_TOKEN) {
            console.log("🚀 [VIP快速通道] 真正呼叫您的專屬 LoRA 模型進行算圖...");
            
            // 🎯 這裡鎖死您的專屬 Version ID (cute-line-laser:33001ca...)
            const createRes = await axios.post('https://api.replicate.com/v1/predictions', {
                version: "33001ca5babe41c8aab61166a2b3442f575890edbde81a4c60dd2cf38d909c57", 
                input: {
                    image: image,
                    // 🌟 封神無敵咒語：強調只要純粹的黑白線條，強制抹除所有背景、陰影、灰色。
                    prompt: "A portrait of a person, TOK_CUTELINE, strictly monochrome, pure black and white line art, minimalist doodle, completely plain white background, isolated on white, NO color, NO shading, NO gray",
                    
                    // 🌟 關鍵拯救參數一：拉高 lora_scale 到 1.3
                    // 強制 AI「百分之百聽您訓練的話」，忽略原照片細節！
                    lora_scale: 1.3, 

                    // 🌟 關鍵拯救參數二：拉高 prompt_strength 到 0.85
                    // 給 AI 85% 的自由度！忘掉真實衣服紋路和背景，直接用塗鴉重畫！
                    prompt_strength: 0.85, 

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

            console.log("⏳ 等待專屬 AI 算圖中 (預計 15-25 秒)...");
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
            
            // 🌟 最終魔法： Sharp 強制二值化
            // 伺服器會像漂白水一樣，把圖裡面不穩定的灰色陰影，通通洗成純白色！確保雷雕機只看到完美的黑白線稿。
            const imgResponse = await axios.get(finalImageUrl, { responseType: 'arraybuffer' });
            const processedBuffer = await sharp(imgResponse.data)
                .greyscale() 
                .threshold(180) 
                .toBuffer();

            const base64Img = "data:image/png;base64," + processedBuffer.toString('base64');
            
            console.log("✅ 純淨黑白雷雕圖已送出！");
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
