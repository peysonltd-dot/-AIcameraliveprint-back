<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>⚡ 雷雕拍照 - 工作人員控制台</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</head>
<body class="bg-gray-100 p-8 font-sans">
    <div id="root" class="max-w-6xl mx-auto"></div>

    <script type="text/babel">
        const { useState, useEffect } = React;

        // ⚠️ 請替換為您的 Render 網址
        const API_BASE_URL = "https://aicameraliveprint-back.onrender.com";

        const AdminPanel = () => {
            const [tasks, setTasks] = useState([]);
            const [loading, setLoading] = useState(false);

            // 每 3 秒自動刷新一次排隊名單
            useEffect(() => {
                const fetchTasks = async () => {
                    try {
                        const res = await fetch(`${API_BASE_URL}/api/admin/tasks`);
                        const data = await res.json();
                        if (data.success) setTasks(data.tasks);
                    } catch (err) {
                        console.error("無法連線至伺服器");
                    }
                };
                fetchTasks();
                const interval = setInterval(fetchTasks, 3000);
                return () => clearInterval(interval);
            }, []);

            // 處理工作人員上傳結果圖
            const handleUploadResult = (e, taskId) => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onloadend = async () => {
                    setLoading(true);
                    try {
                        await fetch(`${API_BASE_URL}/api/admin/upload-result/${taskId}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ resultImage: reader.result })
                        });
                        alert(`號碼 #${taskId} 上傳成功！前端已跳轉。`);
                    } catch (err) {
                        alert("上傳失敗，請檢查網路");
                    }
                    setLoading(false);
                };
                reader.readAsDataURL(file);
            };

            return (
                <div>
                    <h1 className="text-3xl font-bold mb-8 text-gray-800">⚡ 工作人員接單控制台 <span className="text-sm font-normal text-gray-500 bg-white px-3 py-1 rounded-full ml-4 shadow">線上排隊人數：{tasks.length} 人</span></h1>
                    
                    {tasks.length === 0 ? (
                        <div className="text-center py-20 text-gray-400 text-xl font-bold border-4 border-dashed border-gray-300 rounded-xl">
                            目前無人排隊，請稍候...
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {tasks.map(task => (
                                <div key={task.id} className="bg-white rounded-xl shadow-lg overflow-hidden border border-gray-200">
                                    <div className="bg-blue-600 text-white font-bold text-xl p-3 flex justify-between items-center">
                                        <span>排隊號碼: #{task.id}</span>
                                        <span className="text-sm font-normal opacity-80">{task.createdAt}</span>
                                    </div>
                                    <div className="p-4 flex flex-col items-center">
                                        <img src={task.sourceImage} className="w-full h-48 object-cover rounded-lg mb-4 border border-gray-200" alt="客人原圖" />
                                        
                                        {/* 第一步：下載 */}
                                        <a href={task.sourceImage} download={`task_${task.id}.jpg`} className="w-full bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 px-4 rounded mb-2 text-center transition">
                                            1. 下載照片 (去 Leonardo 生圖)
                                        </a>

                                        {/* 第二步：上傳 */}
                                        <label className={`w-full text-center font-bold py-3 px-4 rounded cursor-pointer transition ${loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-500 hover:bg-green-400 text-white'}`}>
                                            {loading ? '上傳中...' : '2. 上傳完成的雷雕圖'}
                                            <input 
                                                type="file" 
                                                accept="image/*" 
                                                className="hidden" 
                                                onChange={(e) => handleUploadResult(e, task.id)}
                                                disabled={loading}
                                            />
                                        </label>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            );
        };

        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(<AdminPanel />);
    </script>
</body>
</html>
