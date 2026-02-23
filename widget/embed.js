/**
 * Venzio Embed Script
 * Añade el widget de voz a cualquier sitio con una sola línea:
 *
 *   <script src="https://TU_DOMINIO/widget/embed.js"
 *           data-api="https://TU_DOMINIO"
 *           data-name="Mi Agente"></script>
 */
(function () {
    const script = document.currentScript || (function () {
        const scripts = document.getElementsByTagName('script');
        return scripts[scripts.length - 1];
    })();

    const apiBase = script.getAttribute('data-api') || 'http://localhost:8000';
    const agentName = script.getAttribute('data-name') || 'Agente Virtual';
    const wsBase = apiBase.replace(/^https/, 'wss').replace(/^http/, 'ws');

    window.VENZIO_API = apiBase;
    window.VENZIO_WS = wsBase;
    window.VENZIO_NAME = agentName;

    function load(url, type, cb) {
        if (type === 'css') {
            const l = document.createElement('link');
            l.rel = 'stylesheet'; l.href = url;
            l.onload = cb; document.head.appendChild(l);
        } else {
            const s = document.createElement('script');
            s.src = url; s.async = true;
            s.onload = cb; document.head.appendChild(s);
        }
    }

    const base = apiBase.replace(/\/$/, '') + '/widget';
    load(base + '/widget.css', 'css', function () {
        load(base + '/widget.js', 'js', function () {
            console.info('[Venzio] Widget cargado ✓');
        });
    });
})();
