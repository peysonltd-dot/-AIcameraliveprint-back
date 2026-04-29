/**
 * AI互動雷雕拍照系統 - 雲端後端伺服器 (方案3：Nano Banana 2 單圖版)
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get('/', (req, res) => {
    res.status(200).send("🟢 AI 雷雕系統 (Nano Banana 2 單圖版) 正常運行中");
});

app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: '未提供圖片資料' });
        console.log("📥 [請求到達] 收到新的影像處理請求");

        // 🔐 使用環境變數讀取金鑰
        const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

        if (REPLICATE_API_TOKEN) {
            console.log("🚀 呼叫 Google Nano Banana 2 進行單圖線稿轉換...");

            const createRes = await axios.post('https://api.replicate.com/v1/models/google/nano-banana-2/predictions', {
                input: {
                    // 🌟 嚴格咒語：強制轉換為純黑白線稿，嚴禁顏色
                    prompt: "Transform this photograph into a pure black and white line art portrait of this exact person, coloring book style, black ink outline on white paper, monochrome, high contrast, clean minimalist vector lines, simple facial contour. strictly NO colors, NO shading, NO gray.",
                    
                    // 🌟 關鍵修改：只放一張照片，避開任何網址 404 的風險
                    image_input: [image], 
                    
                    aspect_ratio: "match_input_image",
                    output_format: "jpg"
                }
            }, {
                headers: { 
                    'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            });

            const predictionUrl = createRes.data.urls.get;
            let isComplete = false;
            let finalImageUrl = null;

            console.log("⏳ Google 大腦計算中 (預計 5~10 秒)...");
            while (!isComplete) {
                await new Promise(resolve => setTimeout(resolve, 1500));
                
                const checkRes = await axios.get(predictionUrl, {
                    headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` }
                });
                
                const status = checkRes.data.status;
                if (status === 'succeeded') {
                    // Nano Banana 2 回傳的是單一字串網址，不是陣列
                    finalImageUrl = checkRes.data.output; 
                    isComplete = true;
                } else if (status === 'failed' || status === 'canceled') {
                    throw new Error('AI 處理失敗: ' + checkRes.data.error);
                }
            }

            console.log("✅ 算圖成功！正在處理回傳...");
            const imgResponse = await axios.get(finalImageUrl, { responseType: 'arraybuffer' });
            const base64Img = "data:image/png;base64," + Buffer.from(imgResponse.data, 'binary').toString('base64');

            return res.status(200).json({ success: true, result: base64Img });

        } else {
            console.log("⚠️ 尚未設定環境變數 REPLICATE_API_TOKEN，退回原圖");
            return res.status(200).json({ success: true, result: image });
        }

    } catch (error) {
        console.error("❌ 伺服器錯誤詳細資訊:");
        if (error.response) {
            console.error(JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message);
        }
        return res.status(200).json({ success: true, result: req.body.image });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 後端啟動於 PORT: ${PORT}`);
});
