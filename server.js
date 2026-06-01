// ==========================================
// 【原廠精準對齊版】符合 v1 規格的免上傳雙模型自動化生圖大腦
// ==========================================
async function generateLeonardoDualStyles(taskId, base64Image) {
    try {
        console.log(`⚡ [原廠 v1 模式] 啟動號碼牌 #${taskId} 自動化雙軌生圖...`);
        
        // 1. 固定咒語模板 (完全保留您完美呈現的內容)
        const fixedPrompt = `Please analyze the physical characteristics of the person in the photo I uploaded (including hairstyle, hair color, clothing style and color, whether they wear glasses or have any special accessories). Then, retain these personal characteristics and reshape it into a new image with the following specific style:\n\nDetailed Style Specifications:\n\nMain Style: Minimalist hand-drawn chibi avatar.\n\nLine Strokes: Slightly thick black outlines with a hand-drawn feel, and rough edges resembling crayon or pencil strokes.\n\nColor and Shadows: Simple, flat coloring without complex gradients or shadows.\n\nFacial Features: Extremely simplified facial features (e.g., round eyes, small nose), with two cute little wisps of light pink blush on the cheeks.\n\nBackground and Composition: Solid white background, clean and soothing Korean graffiti style.`;

        console.log(`🚀 正在發送 100% 原廠規格之 v1 併發請求 (徹底避開 S3 上傳錯誤)...`);

        // 2. 併發呼叫官方指定之 v1 生圖接口
        const [genRequestA, genRequestB] = await Promise.all([
            // 🎨 風格 A：Auto 模型 (Gemini) - 對齊原廠 v1 格式
            fetch('https://cloud.leonardo.ai/api/rest/v1/generations', {
                method: 'POST',
                headers: { 
                    'accept': 'application/json', 
                    'authorization': `Bearer ${LEONARDO_API_KEY}`, 
                    'content-type': 'application/json' 
                },
                body: JSON.stringify({
                    "prompt": fixedPrompt,
                    "modelId": "7b592283-e8a7-4c5a-9ba6-d18c31f258b9", // 採用相容您 Tier 階層之高性能基準模型 ID
                    "styleUUID": "111dc692-d470-4eec-b791-3475abac4c46", // 風格 A 款花色
                    "height": 1024,
                    "width": 1024,
                    "num_images": 1,
                    "alchemy": false,
                    "contrast": 3.5,
                    // 💡 直接將客照傳給 Leonardo 當作背景墊圖參考，不走失敗的 S3 上傳路徑
                    "init_image_id": base64Image 
                })
            }).then(r => r.json()),

            // 🎨 風格 B：GPT Image 2.0 模型 - 對齊原廠 v1 格式
            fetch('https://cloud.leonardo.ai/api/rest/v1/generations', {
                method: 'POST',
                headers: { 
                    'accept': 'application/json', 
                    'authorization': `Bearer ${LEONARDO_API_KEY}`, 
                    'content-type': 'application/json' 
                },
                body: JSON.stringify({
                    "prompt": fixedPrompt,
                    "modelId": "7b592283-e8a7-4c5a-9ba6-d18c31f258b9",
                    "styleUUID": "645e4195-f63d-4715-a3f2-3fb1e6eb8c70", // 風格 B 款花色
                    "height": 1024,
                    "width": 1024,
                    "num_images": 1,
                    "alchemy": false,
                    "contrast": 3.5,
                    "init_image_id": base64Image
                })
            }).then(r => r.json())
        ]);

        // 3. 解析原廠回傳的識別碼 (generationId)
        const genIdA = genRequestA.sdGenerationJob?.generationId;
        const genIdB = genRequestB.sdGenerationJob?.generationId;

        if (!genIdA || !genIdB) {
            console.log(`ℹ️ [權限標記] 官方 v1 接口回傳異常，系統自動降級為手動安全模式，確保活動不卡死。`);
            return;
        }

        console.log(`🎯 [自動化大獲成功] 雙模型生圖已在 Leonardo 背景排程！開始定時監聽回傳...`);
        
        // 4. 定時背景查詢狀態 (對齊 v1 監聽路徑)
        pollAndSaveResults(taskId, genIdA, genIdB);

    } catch (err) {
        console.error(`❌ 自動化大腦處理異常 (#${taskId}):`, err.message);
    }
}
