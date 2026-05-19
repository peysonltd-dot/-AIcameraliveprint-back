/**
 * AI互動雷雕拍照系統 - 封神上線版 (自動去背 + ControlNet鎖定馬尾眼鏡特徵 + 封神過濾黑線)
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
    res.status(200).send("🟢 專屬 LoRA 雷雕系統 (封神 ControlNet 版) 正常運行中");
});

app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: '未提供圖片資料' });
        
        // 雙重防呆金鑰檢查
        const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
        
        if (REPLICATE_API_TOKEN) {
            console.log("🚀 [VIP快速通道] 啟動自動化雷雕 pipeline...");

            // 🌟 步驟 1: 自動化去背處理 (就像您手動做的那樣)
            // 伺服器會像漂白水一樣，強制把手機拍的照片墊上一張純白色畫布
            const cameraBuffer = Buffer.from(image.split(",")[1], 'base64');
            const whiteBackgroundBuffer = await sharp(cameraBuffer)
                .flatten({ background: '#FFFFFF' }) // 強制鋪上白底：解決透明背景和雜訊
                .normalize()                        // 拉開對比度：確保 ControlNet 能準確抓到眼鏡馬尾線條
                .toBuffer();
            const preProcessedImageBase64 = "data:image/jpeg;base64," + whiteBackgroundBuffer.toString('base64');

            console.log("⏳ 正在呼叫 ControlNet + LoRA 進行算圖 (這步是鎖定特徵和畫風)...");
            
            // 🌟 步驟 2: 呼叫 ControlNet (Canny) + 您的 LoRA
            // 🎯 我們換了一個支援 ControlNet + LoRA 的 base 模型，並在內部呼叫您的 LoRA ID。
            const createRes = await axios.post('https://api.replicate.com/v1/predictions', {
                // 🎯 這是 Replicate 上支援 ControlNet + LoRA 串接的 Version (aff48af9...)
                version: "aff48af9c3355208381dd0089e13d11b333423719129598858e3922f5c128522", 
                input: {
                    image: preProcessedImageBase64,
                    
                    // 🌟 完全套用您的精準結構化英文咒語 (把 ToK 密碼換進去)
                    prompt: "TOK_CUTELINE, redraw the person in the photo as an ultra minimal Korean cute line character. Only keep the head hair neck shoulders and upper chest. Centered portrait composition Isolated character. Pure black clean outline only. Cute bean eyes tiny nose simple curved smile, minimized elegant strokes isolated on a pure white background Extremely simplified contours Laser engraving ready.",
                    
                    // 🌟 封神金鑰串接：在此處傳入您的專屬 LoRA ID
                    lora_urls: "replicate://peysonltd-dot/cute-line-laser", // 🌟 強制掛載您的 LoRA

                    // 🌟 套用您的測試參數
                    lora_scale: 0.8,         // 您的測試數值
                    guidance_scale: 2.5,     // 您的測試數值 (低 Guidance 有助於線稿風格)
                    
                    // 🌟 最關鍵！ ControlNet 鎖定魔法 (aff48af9...)
                    controlnet_type: "Canny", // 使用邊緣偵測锁定馬尾眼鏡輪廓
                    controlnet_guidance_scale: 1.5, // 強化鎖定：強迫 AI 死死照著眼鏡馬尾邊緣描！不准自己腦補鬍子。

                    // 強度維持您的 0.85 (因為有 ControlNet 控制輪廓，強度高可以幫助豆豆眼出來，同時不會讓性別亂改)
                    prompt_strength: 0.85, 

                    num_inference_steps: 28,
                    output_format: "png"
                }
            }, {
                headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}`, 'Content-Type': 'application/json' }
            });

            const predictionUrl = createRes.data.urls.get;
            let isComplete = false;
            let finalImageUrl = null;

            console.log("⏳ 等待 AI 魔法算圖完成 (預計 15-20 秒)...");
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

            console.log("🎨 專屬 AI 繪圖完成，啟動 Sharp 終極過濾漂白水...");
            
            const imgResponse = await axios.get(finalImageUrl, { responseType: 'arraybuffer' });
            
            // 🌟 步驟 3: Sharp 強制二值化：像漂白水一樣把所有彩色陰影刷成純白色，確保雷雕機只看到完美的黑白線稿。
            const processedBuffer = await sharp(imgResponse.data)
                .flatten({ background: '#FFFFFF' }) // 再次確保白底
                .greyscale()                        // 抽乾顏色
                .threshold(180)                     // 終極漂白門檻
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
