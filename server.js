/**
 * AI互動雷雕拍照系統 - 雲端後端伺服器
 * 專為 Render 等雲端平台設計，包含 AI 算圖與自動回退機制
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios'); // 用於呼叫外部 AI API 與下載圖片

const app = express();
// 雲端平台會自動分配 PORT 給環境變數，本地端預設使用 3001
const PORT = process.env.PORT || 3001; 

// 允許所有跨域請求 (讓您放在 GitHub Pages 或任何地方的前端都能存取)
app.use(cors());

// 照片 Base64 字串很長，必須加大上傳限制到 50mb
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ==========================================
// 1. 健康檢查端點 (雲端平台確認伺服器存活的關鍵)
// ==========================================
app.get('/', (req, res) => {
    res.status(200).send(`
        <h2>🟢 AI 雷雕拍照系統 API 正常運行中</h2>
        <p>請從前端應用程式發送 POST 請求至 <code>/api/generate-lineart</code></p>
    `);
});

// ==========================================
// 2. 核心 AI 影像生成端點
// ==========================================
app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body;

        if (!image) {
            return res.status(400).json({ error: '未提供圖片資料' });
        }
        
        console.log("📥 [請求到達] 收到新的影像處理請求");

        // 讀取環境變數中的 Replicate API 金鑰
        // (在 Render 的 Environment Variables 裡設定 REPLICATE_API_TOKEN)
        const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

        // --- 情境 A：已設定 AI 金鑰，呼叫雲端強大算圖 ---
        if (REPLICATE_API_TOKEN) {
            console.log("🚀 偵測到 API Token，開始呼叫 Replicate ControlNet Lineart...");

            // 步驟 1: 發送生成請求
            const createRes = await axios.post('https://api.replicate.com/v1/predictions', {
                version: "435061a1b5a4c1e26740464bf786efdfa9cb3a3ac488595a2723f4368cb2f58f", // ControlNet Lineart (專門針對線稿)
                input: {
                    image: image,
                    prompt: "masterpiece, pure line art, white background, black lines, clean vector art, strictly black and white, flat, no shadows, no gray",
                    negative_prompt: "shadows, colors, shading, gray, realistic, photorealistic, noise, gradient",
                    num_inference_steps: 20
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

            // 步驟 2: 每隔 1 秒輪詢檢查 AI 是否算圖完成
            console.log("⏳ 等待 AI 算圖中...");
            while (!isComplete) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                const checkRes = await axios.get(predictionUrl, {
                    headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` }
                });
                
                const status = checkRes.data.status;
                if (status === 'succeeded') {
                    finalImageUrl = checkRes.data.output[0]; // 取得完成的圖片網址
                    isComplete = true;
                } else if (status === 'failed' || status === 'canceled') {
                    throw new Error('Replicate 遠端處理失敗');
                }
            }

            console.log("✅ AI 算圖完成！正在轉換格式...");

            // 步驟 3: 將算出來的圖片 URL 載下來轉回 Base64 (為了配合前端上傳 Firebase 的邏輯)
            const imgResponse = await axios.get(finalImageUrl, { responseType: 'arraybuffer' });
            const base64Img = "data:image/png;base64," + Buffer.from(imgResponse.data, 'binary').toString('base64');

            console.log("📤 [回應成功] 傳送完美線稿至前端");
            return res.status(200).json({ success: true, result: base64Img });

        } 
        // --- 情境 B：未設定金鑰，啟用備用回退機制 ---
        else {
            console.log("⚠️ 未設定 REPLICATE_API_TOKEN，原圖退回由前端演算法處理");
            
            // 模擬網路延遲
            await new Promise(resolve => setTimeout(resolve, 800)); 

            // 原樣回傳，前端收到後會自己啟動 Sobel 邊緣偵測來轉線稿
            return res.status(200).json({
                success: true,
                result: image 
            });
        }

    } catch (error) {
        console.error("❌ 伺服器處理錯誤:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'AI 伺服器處理失敗' });
    }
});

// ==========================================
// 啟動伺服器
// ==========================================
app.listen(PORT, () => {
    console.log(`
=============================================
🚀 雲端後端伺服器已成功啟動！
👉 運行於 PORT: ${PORT}
👉 Replicate AI 狀態: ${process.env.REPLICATE_API_TOKEN ? '🟢 已啟動 (金鑰已設定)' : '🟡 測試模式 (未設定金鑰，交由前端處理)'}
=============================================
    `);
});