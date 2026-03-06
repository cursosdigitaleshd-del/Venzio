/**
 * Venzio Embed Script
 * Carga e inicializa el widget de voz
 *
 * Uso:
 * <script
 *   src="https://dominio/widget/embed.js"
 *   data-api="https://dominio"
 *   data-name="Agente"
 *   data-site-id="SITE_ID">
 * </script>
 */

(function () {
    'use strict';

    const script = document.currentScript || (function () {
        const scripts = document.getElementsByTagName('script');
        return scripts[scripts.length - 1];
    })();

    // Read attributes
    const apiBase = script.getAttribute('data-api') || 'https://venzio.online';
    const agentName = script.getAttribute('data-name') || 'Agente Virtual';
    const siteId = script.getAttribute('data-site-id');

    if (!siteId) {
        console.error('[Venzio] data-site-id is required');
        return;
    }

    // Load CSS
    function loadCSS(url) {
        if (document.getElementById('vz-styles')) return;

        const link = document.createElement('link');
        link.id = 'vz-styles';
        link.rel = 'stylesheet';
        link.href = url;
        document.head.appendChild(link);
    }

    // Load JS module
    function loadJS(url) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.type = 'module';
            script.src = url;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    // Initialize widget
    async function initWidget() {
        try {
            // Load CSS
            const cssUrl = `${apiBase.replace(/\/$/, '')}/widget/widget.css`;
            loadCSS(cssUrl);

            // Load widget module
            const jsUrl = `${apiBase.replace(/\/$/, '')}/widget/widget.js`;
            await loadJS(jsUrl);

            // Import and initialize
            const { VenzioWidget } = await import(jsUrl);

            // Get voice ID (you might need to fetch available voices)
            // For now, assume voice ID 1 or fetch from API
            const voiceId = 1; // TODO: Make this configurable or fetch from API

            // Create widget instance
            window.VenzioWidget = new VenzioWidget({
                apiBase: apiBase,
                agentName: agentName,
                siteId: siteId,
                voiceId: voiceId,
            });

            console.log('[Venzio] Widget initialized successfully');

        } catch (error) {
            console.error('[Venzio] Failed to initialize widget:', error);
        }
    }

    // Wait for DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWidget);
    } else {
        initWidget();
    }

})();