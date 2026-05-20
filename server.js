/**
 * AI互動雷雕拍照系統 - SDXL 終極完全體 (邊緣草圖引導 + 專屬大腦)
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
    res.status(200).send("🟢 專屬 SDXL 雷雕系統 (草圖引導完全體) 正常運行中");
});

app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: '未提供圖片資料' });
        
        const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
        
        if (REPLICATE_API_TOKEN) {
            console.log("🚀 啟動 SDXL 自動化雷雕 pipeline...");

            // ==========================================
            // 🌟 步驟 1: 偽 ControlNet 邊緣檢測 (把真人照變成草圖)
            // ==========================================
            const cameraBuffer = Buffer.from(image.split(",")[1], 'base64');
            const edgeKernel = {
                width: 3, height: 3,
                kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1]
            };

            const sketchBuffer = await sharp(cameraBuffer)
                .flatten({ background: '#FFFFFF' })
                .greyscale()                        // 轉灰階
                .convolve(edgeKernel)               // 抓出眼鏡、頭髮、五官的輪廓
                .negate()                           // 反轉成白底黑線
                .normalize()                        // 拉高對比度
                .toBuffer();
                
            const preProcessedImageBase64 = "data:image/jpeg;base64," + sketchBuffer.toString('base64');

            console.log("⏳ 草圖生成完畢，呼叫專屬 SDXL 大腦進行算圖...");
            
            // ==========================================
            // 🌟 步驟 2: 呼叫您的專屬 SDXL 模型
            // ==========================================
            const createRes = await axios.post('https://api.replicate.com/v1/predictions', {
                version: "468313b6a3efd117687f29683d22de9ea741442e67d6443d9fd340db4d612cbe", 
                input: {
                    image: preProcessedImageBase64, // 💡 傳給 AI 的是帶有眼鏡的「線稿草圖」
                    
                    prompt: "TOK_CUTELINE-SDXL, a minimal black and white line art portrait of a person, cute Korean minimal character, bean eyes, simple smile. Pure black vector outline, white fill, plain white background, laser engraving ready.",
                    negative_prompt: "colors, shading, gradients, grayscale, solid black fills, realistic, photorealistic, 3d, complex background, noisy lines, artifacts",
                    
                    // 🌟 參數解鎖！
                    // 因為底圖已經是草圖，我們可以大膽拉高 guidance_scale，強迫 AI 畫出乾淨的極簡畫風！
                    prompt_strength: 0.65, 
                    guidance_scale: 7.5,   // 恢復高固執度，確保畫風不泥濘
                    lora_scale: 0.8,
                    num_inference_steps: 30
                }
            }, {
                headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}`, 'Content-Type': 'application/json' }
            });

            const predictionUrl = createRes.data.urls.get;
            let isComplete = false;
            let finalImageUrl = null;

            console.log("⏳ 等待 AI 魔法算圖完成...");
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

            console.log("🎨 算圖完成，啟動 Sharp 終極洗白...");
            
            // ==========================================
            // 🌟 步驟 3: 終極漂白水 (因為 AI 出圖已經是純白底了，這裡只做最後的保險過濾)
            // ==========================================
            const imgResponse = await axios.get(finalImageUrl, { responseType: 'arraybuffer' });
            const processedBuffer = await sharp(imgResponse.data)
                .flatten({ background: '#FFFFFF' }) 
                .greyscale()                        
                .normalize()
                .threshold(180) 
                .toBuffer();

            const base64Img = "data:image/png;base64," + processedBuffer.toString('base64');
            
            console.log("✅ 純淨黑白雷雕圖已送出！");
            return res.status(200).json({ success: true, result: base64Img });

        } else {
            return res.status(200).json({ success: true, result: image });
        }

    } catch (error) {
        console.error("❌ 處理失敗:", error.response ? JSON.stringify(error.response.data) : error.message);
        return res.status(500).json({ error: '生成失敗' });
    }
});

app.listen(PORT, () => console.log(`🚀 伺服器啟動於 PORT: ${PORT}`));
