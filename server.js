/**
 * AI互動雷雕拍照系統 - [方案 B] 偽 ControlNet 邊緣檢測流
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
    res.status(200).send("🟢 專屬 LoRA 雷雕系統 (方案B 邊緣檢測流) 正常運行中");
});

app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: '未提供圖片資料' });
        
        const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
        
        if (REPLICATE_API_TOKEN) {
            console.log("🚀 啟動方案 B：偽 ControlNet 邊緣檢測 pipeline...");

            // ==========================================
            // 🌟 方案 B 核心：程式化邊緣檢測 (Edge Detection)
            // ==========================================
            const cameraBuffer = Buffer.from(image.split(",")[1], 'base64');
            
            // 建立拉普拉斯邊緣檢測矩陣 (Laplacian Kernel)
            const edgeKernel = {
                width: 3,
                height: 3,
                kernel: [
                    -1, -1, -1,
                    -1,  8, -1,
                    -1, -1, -1
                ]
            };

            const sketchBuffer = await sharp(cameraBuffer)
                .flatten({ background: '#FFFFFF' })
                .greyscale()                        // 1. 轉灰階
                .convolve(edgeKernel)               // 2. 邊緣檢測 (把所有輪廓線抓出來，此時是黑底白線)
                .negate()                           // 3. 顏色反轉 (變成雷雕要的白底黑線草圖！)
                .normalize()                        // 4. 拉高對比度
                .toBuffer();
                
            const preProcessedImageBase64 = "data:image/jpeg;base64," + sketchBuffer.toString('base64');

            console.log("⏳ 邊緣草圖生成完畢，呼叫 FLUX 進行畫風轉化...");
            
            // ==========================================
            // 🌟 呼叫 FLUX API
            // ==========================================
            const createRes = await axios.post('https://api.replicate.com/v1/predictions', {
                version: "33001ca5babe41c8aab61166a2b3442f575890edbde81a4c60dd2cf38d909c57", 
                input: {
                    image: preProcessedImageBase64, // 💡 傳給 AI 的已經是「線稿草圖」了！
                    
                    // 💡 咒語微調：告訴 AI 它拿到的是線稿，請幫我把臉改成豆豆眼
                    prompt: "TOK_CUTELINE, redraw this sketch as a cute Korean minimal line character. Change the eyes to cute bean eyes. Pure black vector outline, white fill, NO shading, NO solid black areas. Plain white background. Laser engraving ready.",
                    
                    model: "dev",
                    go_fast: false,
                    lora_scale: 0.8,
                    megapixels: "1",
                    num_outputs: 1,
                    aspect_ratio: "1:1",
                    output_format: "png",
                    guidance_scale: 3.5,
                    extra_lora_scale: 1.05,
                    num_inference_steps: 28,
                    
                    // 🌟 因為底圖已經是線稿了，我們只需要 AI「微微調整畫風跟眼睛」，所以強度稍微調降
                    prompt_strength: 0.65, 
                    output_quality: 80
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
            
            const imgResponse = await axios.get(finalImageUrl, { responseType: 'arraybuffer' });
            
            const processedBuffer = await sharp(imgResponse.data)
                .flatten({ background: '#FFFFFF' }) 
                .greyscale()                        
                .normalize()
                .threshold(180) // 嚴格二值化
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
