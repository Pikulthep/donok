export const config = {
    // ใช้ Edge Runtime เพราะเหมาะกับการสตรีมวิดีโอ (ไม่ติดข้อจำกัดขนาดไฟล์เหมือน Serverless ปกติ)
    runtime: 'edge', 
};

export default async function handler(req) {
    // ดึง URL ที่ต้องการจะเล่นจาก Parameter (เช่น /api/proxy?url=...)
    const url = new URL(req.url);
    const targetUrl = url.searchParams.get('url');

    if (!targetUrl) {
        return new Response('Missing target URL', { status: 400 });
    }

    try {
        // ให้ Vercel แอบไปดึงข้อมูลจากลิงก์ HTTP ต้นทาง
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        // ดึงประเภทของไฟล์
        const contentType = response.headers.get('content-type') || '';
        const isM3U8 = contentType.includes('mpegurl') || targetUrl.includes('.m3u8') || targetUrl.includes('extension=m3u8');

        // ตั้งค่า Header ตอบกลับเพื่ออนุญาตให้ทุกเว็บเล่นไฟล์นี้ได้ (แก้ปัญหา CORS)
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': contentType,
        };

        // หากเป็นไฟล์ Playlist (m3u8) ต้องเข้าไปแก้ไขลิงก์ย่อยด้านใน
        if (isM3U8) {
            const text = await response.text();
            const baseUrl = new URL(targetUrl);
            
            const rewrittenText = text.split('\n').map(line => {
                if (line.trim().startsWith('#') || line.trim() === '') return line;
                
                // แปลงลิงก์ .ts ด้านใน m3u8 ให้ต้องวิ่งผ่าน proxy ของเราเสมอ
                let absoluteUrl = line.startsWith('http') ? line : new URL(line, baseUrl).href;
                return `/api/proxy?url=${encodeURIComponent(absoluteUrl)}`;
            }).join('\n');

            return new Response(rewrittenText, { headers: corsHeaders });
            
        } else {
            // หากเป็นไฟล์วิดีโอ (.ts) ให้สตรีมข้อมูลภาพกลับไปหาผู้ใช้โดยตรง
            return new Response(response.body, { headers: corsHeaders });
        }
        
    } catch (error) {
        return new Response(`Error: ${error.message}`, { status: 500 });
    }
}
