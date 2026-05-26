/**
 * Sistemi i fotografimit ndërveprues me gdhendje lazer AI - API i Serverit (Versioni LLaVA me Kod Publik)
 * Funksionet kryesore:
 * 1. Pranon fotot nga makineria e vizitorëve, krijon numra radhe dhe nxjerr tiparet e fytyrës
 * 2. Detajon me saktësi: kapjen e flokëve (bisht, princeshë, gërsheta), ndarjen e flokëve, aksesorët (syze, vathë, varëse) dhe shprehitë
 * 3. Kalon 100% bllokimet e modelit Llama nga Meta, gati për përdorim të menjëhershëm pa nënshkruar kontrata!
 * 4. Ka mbrojtje të fortë për leximin e JSON, parandalon bllokimet ose dështimet e sistemit në terren.
 */
const express = require('express');
const cors = require('cors');
const Replicate = require('replicate');

const app = express();
const PORT = process.env.PORT || 10000; 

// Inicializimi i ndërfaqes Replicate AI (Lexon automatikisht variablin e mjedisit REPLICATE_API_TOKEN)
const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN || "", 
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ==========================================
// Memorizimi kryesor (Rruajtja e statusit të radhës)
// ==========================================
const tasks = {};
let ticketCounter = 1;

app.get('/', (req, res) => {
    res.status(200).send("🟢 Serveri i radhës është aktiv (Modeli Publik LLaVA është i gatshëm). Sistemi po punon në mënyrë të qëndrueshme.");
});

// ==========================================
// 📱 API për makinerinë e vizitorëve në terren
// ==========================================

// 1. Vizitori bën foto dhe ngarkon, merr numrin e radhës dhe aktivizon analizën LLaVA në sfond
app.post('/api/upload', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) {
            return res.status(400).json({ error: 'Nuk u gjetën të dhënat e imazhit' });
        }

        const taskId = String(ticketCounter).padStart(3, '0');
        ticketCounter++;

        // Prompt rezervë me cilësi të lartë (Në rast vonesash ose dështimi të Token-it)
        let fallbackPrompt = `Quirky minimalist hand-drawn doodle portrait, naive art, chibi kawaii aesthetic. Extreme chibi proportions, huge oversized head, tiny small body, narrow sloping shoulders. Extremely simplified facial features, simple vertical dot eyes, tiny line nose, soft blurred pink blush on cheeks. Clean simple neck, wearing a basic round neck t-shirt. Drawn with a monoline marker brush. Flat soft colors. Solid pure white background, no shading, no realistic eyes.`;

        tasks[taskId] = {
            id: taskId,
            sourceImage: image, 
            status: 'pending',  
            resultImage: null,  
            remark: '',         
            suggestedPrompt: fallbackPrompt, 
            createdAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }) 
        };

        console.log(`🎫 U krijua detyra e re: Numri i radhës #${taskId}, duke u përgatitur për analizë me LLaVA...`);
        res.json({ success: true, taskId: taskId });

        // Analizë asinkrone në sfond pa bllokuar përvojën e vizitorit në ekran
        if (process.env.REPLICATE_API_TOKEN) {
            analyzeImageAndGeneratePrompt(taskId, image);
        } else {
            console.log("⚠️ [PARALAJMËRIM] REPLICATE_API_TOKEN nuk është vendosur në Render! Do të përdoret vetëm prompti rezervë.");
        }

    } catch (error) {
        console.error("Gabim gjatë ngarkimit të imazhit:", error);
        res.status(500).json({ error: 'Gabim i serverit, ju lutem provoni përsëri më vonë' });
    }
});

// 2. Klienti bën kërkesa të vazhdueshme (Polling) për të kontrolluar nëse imazhi është gati
app.get('/api/status/:taskId', (req, res) => {
    const taskId = req.params.taskId;
    const task = tasks[taskId];
    
    if (!task) {
        return res.status(404).json({ error: 'Nuk u gjet asnjë detyrë met këtë numër' });
    }

    res.json({ 
        success: true, 
        status: task.status, 
        resultImage: task.resultImage 
    });
});

// ==========================================
// 💻 API për stafin në terren (Paneli i Kontrollit)
// ==========================================

app.get('/api/admin/all-tasks', (req, res) => {
    const all = Object.values(tasks)
        .sort((a, b) => a.id.localeCompare(b.id));
    res.json({ success: true, tasks: all });
});

app.post('/api/admin/upload-result/:taskId', (req, res) => {
    try {
        const taskId = req.params.taskId;
        const { resultImage } = req.body;
        const task = tasks[taskId];

        if (!task) {
            return res.status(404).json({ error: 'Nuk u gjet kjo detyrë' });
        }
        task.status = 'completed'; 
        task.resultImage = resultImage; 

        console.log(`✅ Detyra u krye: Numri #${task.id} u ngarkua me sukses dhe u dërgua te klienti`);
        res.json({ success: true });
    } catch (error) {
        console.error("Gabim gjatë ngarkimit të rezultatit:", error);
        res.status(500).json({ error: 'Ngarkimi dështoi, ju lutem provoni përsëri' });
    }
});

app.post('/api/admin/update-status/:taskId', (req, res) => {
    try {
        const taskId = req.params.taskId;
        const { status } = req.body;
        const task = tasks[taskId];

        if (!task) {
            return res.status(404).json({ error: 'Nuk u gjet kjo detyrë' });
        }
        task.status = status;
        res.json({ success: true, status: task.status });
    } catch (error) {
        console.error("Gabim gjatë përditësimit të statusit:", error);
        res.status(500).json({ error: 'Përditësimi dështoi' });
    }
});

app.post('/api/admin/save-remark/:taskId', (req, res) => {
    try {
        const taskId = req.params.taskId;
        const { remark } = req.body;
        const task = tasks[taskId];

        if (!task) {
            return res.status(404).json({ error: 'Nuk u gjet kjo detyrë' });
        }
        task.remark = remark || '';
        res.json({ success: true });
    } catch (error) {
        console.error("Gabim gjatë ruajtjes së shënimit:", error);
        res.status(500).json({ error: 'Ruajtja dështoi' });
    }
});

// ==========================================
// 🧠 Modeli vizual publik LLaVA - Funksioni i analizës së saktë të tipareve
// ==========================================
async function analyzeImageAndGeneratePrompt(taskId, base64Image) {
    try {
        console.log(`[Vision AI] Numri #${taskId}: Duke dërguar kërkesën për analizë te yorickvp/llava-13b...`);
        
        // Prompt i fortë i krijuar posaçërisht për LLaVA
        const promptText = `
        You are a highly precise visual analysis assistant. Carefully inspect the provided portrait and extract details.
        Output ONLY a JSON block inside curly braces, containing these exact attributes:
        {
          "gender": "man, woman, boy, or girl",
          "hairLength": "short, shoulder-length, or long",
          "hairTexture": "straight, wavy, or curly",
          "hairStyle": "ponytail (馬尾), princess (公主頭), braids (雙辮子), loose hair (散髮), messy bun (包包頭)",
          "hairParting": "center-parted (中分), side-parted (旁分), or no parting",
          "bangs": "wispy bangs (空氣劉海), blunt bangs (齊劉海), or no bangs",
          "hairColor": "black, brown, blonde, or dyed color",
          "glasses": "wearing glasses, or no glasses",
          "necklace": "wearing necklace, or no necklace",
          "earrings": "wearing earrings, or no earrings",
          "expression": "smiling, or neutral",
          "clothingType": "t-shirt, shirt, hoodie, or jacket",
          "clothingColor": "black, white, red, blue, green, etc."
        }
        Do not write any markdown wrappers like \`\`\`json or \`\`\`. Output raw JSON directly.
        `;

        // 🌟 100% 依據截圖優化：使用 replicate.stream 進行非同步串流，且 input 僅傳入標準 image 與 prompt，徹底避免 422 格式報錯
        let rawText = "";
        for await (const event of replicate.stream(
            "yorickvp/llava-13b:80537f9eead1a5bfa72d5ac6ea6414379be41d4d4f6679fd776e9535d1eb58bb",
            {
                input: {
                    image: base64Image,
                    prompt: promptText.trim()
                }
            }
        )) {
            rawText += event;
        }

        console.log(`[Vision AI] Numri #${taskId}: Procesi u ekzekutua me sukses me një gjatësi prej ${rawText.length} karakteresh.`);

        // Pastrimi i kodit Markdown JSON në rast se modeli e shton atë gabimisht
        let cleanText = rawText.trim();
        cleanText = cleanText.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();

        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Rezultati nuk përmban një objekt të vlefshëm JSON { ... }");

        const f = JSON.parse(jsonMatch[0]);
        console.log(`[Vision AI] Numri #${taskId} u analizua me sukses:`, {
            gender: f.gender,
            hairStyle: f.hairStyle,
            glasses: f.glasses,
            necklace: f.necklace,
            earrings: f.earrings
        });

        // Ndërtimi i promptit perfekt duke ndërthurur flokët, syzet, vathët dhe të gjitha detajet e rëndësishme
        const customPrompt = `Quirky minimalist hand-drawn doodle portrait of a ${f.gender || 'person'} with ${f.hairLength || 'medium'} ${f.hairTexture || 'straight'} ${f.hairColor || 'black'} hair styled in a ${f.hairStyle || 'classic loose hair style'} with a ${f.hairParting || 'natural parting'} and ${f.bangs || 'no bangs'}, showing a ${f.expression || 'neutral calm face'}. The person is ${f.glasses || 'no glasses'}, ${f.necklace || 'no necklace'}, and ${f.earrings || 'no earrings'}. Wearing a plain unpatterned solid ${f.clothingColor || 'white'} ${f.clothingType || 't-shirt'}, absolutely no logos, no graphics, no text on shirt. Naive art, chibi kawaii aesthetic. Extreme chibi proportions, huge oversized head, tiny small body, narrow sloping shoulders. Extremely simplified facial features, simple vertical black dot eyes, tiny line nose, soft blurred pink blush on cheeks. Smooth clean bare neck, absolutely no neck lines. Clean solid color hair, no white dots, no shading. Drawn with a monoline marker brush. Flat soft colors. Solid pure white background.`;

        if (tasks[taskId]) {
            tasks[taskId].suggestedPrompt = customPrompt;
            console.log(`🎯 Prompti i personalizuar për numrin #${taskId} u ruajt me sukses!`);
        }

    } catch (err) {
        console.error(`❌ [Vision AI] Numri #${taskId} gabim gjatë ekzekutimit të LLaVA:`, err.message);
    }
}

// Fillo serverin
app.listen(PORT, () => {
    console.log(`🚀 Serveri i radhës dhe i gjenerimit të prompteve AI nisi me sukses! Duke dëgjuar në PORT: ${PORT}`);
});
