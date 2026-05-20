/**
 * AI 互動雷雕拍照系統 - 後端 API (Render 部署版)
 * 終極大絕招：完全捨棄 Google Gemini，改用 Replicate LLaVA 視覺大模型
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
// 🛑 已經將 Google Gemini 套件完全移除
const Replicate = require('replicate');

const app = express();
const PORT = process.env.PORT || 10000; 

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

app.get('/', (req, res) => {
    res.status(200).send("🟢 AI Photo Booth Backend is running (Replicate Only Version).");
});

app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: '未提供圖片資料' });

        console.log("🚀 [步驟一] 啟動 Replicate LLaVA 視覺模型分析照片...");

        // 🌟 修正：移除舊版寫死的亂碼版本號，讓系統自動抓取最新版
        const llavaModel = "yorickvp/llava-13b";
        const visionPrompt = "Describe the person in this image concisely: gender, age vibe, hair style, expression, and clothing neckline. Use keywords separated by commas.";

        // 預設特徵：萬一視覺模型秀逗，以此作為備案，保證一定能畫出圖
        let description = "a person looking at the camera";

        try {
            // Replicate 原生支援前端傳來的 Data URI Base64 格式
            const llavaOutput = await replicate.run(llavaModel, {
                input: {
                    image: image, 
                    prompt: visionPrompt,
                    max_tokens: 50
                }
            });
            // LLaVA 回傳的是字串陣列，將其合併成單一字串
            description = llavaOutput.join("").trim();
            console.log("✅ 視覺解析成功:", description);
        } catch (visionError) {
            console.warn("⚠️ 視覺模型解析失敗，啟動備用特徵 (不影響後續畫圖):", visionError.message);
        }

        // 🌟 步驟二：提示詞自動組裝
        const triggerWord = process.env.REPLICATE_TRIGGER_WORD || "TOK_CUTELINE-SDXL";
        const assembledPrompt = `${triggerWord}, a person described as: ${description}. Minimalist black and white line art portrait, doodle style, simple dots for eyes, pure white background, pure lines, no shading, flat vector graphic, laser engraving ready.`;
        
        const negativePrompt = "color, photorealistic, realistic face, detailed eyes, shading, gradient, texture, complex background, 3d, realistic lips, solid black fills, messy lines";

        console.log("🚀 [步驟三] 呼叫 Replicate SDXL 進行雷雕線稿繪製...");
        console.log("👉 最終咒語:", assembledPrompt);
        
        // 呼叫您專屬客製化訓練的 SDXL 模型
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

        const finalImageUrl = Array.isArray(output) ? output[0] : output;
        
        console.log("✅ 圖像生成成功！URL:", finalImageUrl);
        return res.status(200).json({ 
            success: true, 
            resultUrl: finalImageUrl,
            extractedFeatures: description 
        });

    } catch (error) {
        console.error("❌ 系統處理錯誤:", error);
        return res.status(500).json({ error: '影像處理失敗，請稍後再試。' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 AI Photo Booth Backend 啟動於 PORT: ${PORT}`);
});
