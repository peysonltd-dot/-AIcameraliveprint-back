/**
 * AI 互動雷雕拍照系統 - 後端 API (Render 部署版)
 * 終極穩定版：使用 BLIP 視覺模型確保特徵抓取，並強制純白背景
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Replicate = require('replicate');

const app = express();
const PORT = process.env.PORT || 10000; 

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

app.get('/', (req, res) => {
    res.status(200).send("🟢 AI Photo Booth Backend is running (BLIP Vision + White BG).");
});

app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: '未提供圖片資料' });

        console.log("🚀 [步驟一] 啟動 Replicate BLIP 視覺模型分析照片...");

        // 🌟 換成最穩定、絕不罷工的 Salesforce BLIP 視覺模型
        const blipModel = "salesforce/blip:2e1dddc8621f72155f24cf2e0adbde548458d3cab9f00c0139eea840d6940c61";
        
        // 防呆備用詞 (直接預設為女性，萬一出錯至少性別是對的)
        let description = "a woman looking at the camera"; 

        try {
            // 呼叫 BLIP，它會自動回傳如 "a woman wearing glasses" 的精準描述
            const blipOutput = await replicate.run(blipModel, {
                input: {
                    image: image,
                    task: "image_captioning"
                }
            });
            
            if (blipOutput) {
                description = String(blipOutput).trim();
                console.log("✅ 視覺解析成功:", description);
            }
        } catch (visionError) {
            console.warn("⚠️ 視覺解析異常，啟用備用特徵:", visionError.message);
        }

        // 🌟 步驟二：畫圖提示詞強化純白底色
        const triggerWord = process.env.REPLICATE_TRIGGER_WORD || "TOK_CUTELINE-SDXL";
        
        // 針對 SDXL 加入極端強烈的白底指令 (pure white background, isolated on white canvas)
        const assembledPrompt = `${triggerWord}, ${description}, minimalist black and white line art portrait, pure solid white background, #FFFFFF background, isolated on solid white canvas, clear black lines, laser engraving design.`;
        
        // 🌟 負向提示詞：死命封殺所有灰色、陰影與漸層
        const negativePrompt = "grey background, gray background, dark background, off-white, shadow, shading, gradient, colored background, skin tone, realistic, 3d, messy lines, text, watermark, signature";

        console.log("🚀 [步驟三] 呼叫 Replicate SDXL 進行雷雕線稿繪製...");
        console.log("👉 最終咒語:", assembledPrompt);
        
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
                    guidance_scale: 8.5, // 拉高服從度，強迫它必須聽從「純白底色」的指令
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
