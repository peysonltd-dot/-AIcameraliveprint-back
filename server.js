/**
 * AI 互動雷雕拍照系統 - 後端 API (Render 部署版)
 * 工作流: 接收照片 -> Gemini 解析特徵 -> 組裝 Prompt -> Replicate SDXL 繪圖
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Replicate = require('replicate');

const app = express();
// Render 預設通常分配 PORT 10000，這裡讓環境變數優先
const PORT = process.env.PORT || 10000; 

// Middleware: 允許跨域請求與加大 Payload 限制 (處理 Base64 照片)
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 初始化 AI 客戶端
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

// 系統狀態檢查端點
app.get('/', (req, res) => {
    res.status(200).send("🟢 AI Photo Booth Backend (Gemini + SDXL) is running on Render.");
});

// 核心生成端點
app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: '未提供圖片資料' });

        console.log("🚀 [步驟一] 接收照片，準備 Gemini 視覺解析...");

        // 🌟 處理 Base64 字串 (Gemini 要求純 Base64，不含 Data URI 前綴)
        const mimeTypeMatch = image.match(/^data:(image\/\w+);base64,/);
        const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : "image/jpeg";
        // 移除前綴，取得乾淨的 base64 資料
        const base64Data = image.replace(/^data:.*;base64,/, "");

        // ==========================================
        // 🌟 步驟二：Gemini 視覺解析 (強制 JSON 輸出)
        // 💡 修正 404 錯誤：加上 -latest 確保能找到最新的模型版本
        // ==========================================
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash-latest", 
            generationConfig: { responseMimeType: "application/json" }
        });

        const prompt = `You are an expert portrait analyst for an automated drawing system. Analyze the uploaded photo (focusing only from the shoulders up) and extract specific physical traits. You MUST return the result EXACTLY as a valid JSON object following this exact structure, without any extra text or markdown blocks:
{
  "age_vibe": "(e.g., child, young adult, middle-aged)",
  "face_shape": "(e.g., round, oval, square, sharp jawline)",
  "hair_details": "(length, texture, parting, bangs, specific style)",
  "expression": "(e.g., neutral, subtle smile, wide toothy smile)",
  "pose": "(e.g., looking straight ahead, head tilted slightly to the right)",
  "clothing_neckline": "(e.g., crew neck, v-neck, collared shirt)",
  "glasses_type": "(e.g., none, thick black square glasses, thin round wire glasses)",
  "accessories": "(e.g., none, small silver hoop earrings, simple necklace)"
}`;

        const imagePart = {
            inlineData: { data: base64Data, mimeType: mimeType }
        };

        const geminiResult = await model.generateContent([prompt, imagePart]);
        const features = JSON.parse(geminiResult.response.text());
        console.log("✅ Gemini 特徵萃取成功:", features);

        // ==========================================
        // 🌟 步驟三：提示詞自動組裝
        // ==========================================
        const triggerWord = process.env.REPLICATE_TRIGGER_WORD || "TOK_CUTELINE-SDXL";
        const assembledPrompt = `${triggerWord}, a ${features.age_vibe} person with a ${features.face_shape}. ${features.hair_details}. The person has a ${features.expression} and ${features.pose}, wearing a ${features.clothing_neckline}. Glasses: ${features.glasses_type}. Accessories: ${features.accessories}. Minimalist black and white line art portrait, doodle style, simple dots for eyes, pure white background, pure lines, no shading, flat vector graphic, laser engraving ready.`;
        
        // 負面提示詞：防護黑炭、寫實陰影
        const negativePrompt = "color, photorealistic, realistic face, detailed eyes, shading, gradient, texture, complex background, 3d, realistic lips, solid black fills, messy lines";

        console.log("🚀 [步驟四] 呼叫 Replicate SDXL 進行文生圖...");
        console.log("👉 組裝咒語:", assembledPrompt);

        // ==========================================
        // 🌟 步驟四：Replicate 圖像生成 (Txt2Img)
        // ==========================================
        // 從環境變數讀取您剛剛在 Render 設定的 Model ID
        const modelVersion = process.env.REPLICATE_MODEL_VERSION; 
        
        const output = await replicate.run(
            modelVersion,
            {
                input: {
                    prompt: assembledPrompt,
                    negative_prompt: negativePrompt,
                    width: 1024,
                    height: 1024,
                    scheduler: "K_EULER",
                    num_outputs: 1,
                    guidance_scale: 7.5,
                    apply_watermark: false,
                    num_inference_steps: 30
                }
            }
        );

        // Replicate 回傳為陣列，取第一張圖
        const finalImageUrl = Array.isArray(output) ? output[0] : output;
        
        console.log("✅ 圖像生成成功！URL:", finalImageUrl);
        return res.status(200).json({ 
            success: true, 
            resultUrl: finalImageUrl,
            extractedFeatures: features // 回傳給前端展示使用
        });

    } catch (error) {
        console.error("❌ 系統處理錯誤:", error);
        return res.status(500).json({ error: '影像處理失敗，請稍後再試。' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 AI Photo Booth Backend 啟動於 PORT: ${PORT}`);
});
