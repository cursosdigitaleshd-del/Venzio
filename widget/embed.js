/**
 * Venzio Widget Embed Loader
 * Loader universal que inicializa el widget de voz
 */

(function() {
    'use strict';

    // Evitar inicialización múltiple
    if (window.VenzioWidgetInstance) {
        console.warn('[Venzio] Widget ya inicializado');
        return;
    }

    // Buscar el script de embed
    const script = document.currentScript;
    if (!script) {
        console.error('[Venzio] No se pudo encontrar el script de embed');
        return;
    }

    // Leer atributos del script
    const siteId = script.getAttribute('data-site-id');
    const agentName = script.getAttribute('data-name') || 'Agente Venzio';

    if (!siteId) {
        console.error('[Venzio] data-site-id es requerido');
        return;
    }

    // Determinar URL base del API desde la URL del script
    const scriptUrl = new URL(script.src);
    const apiBase = `${scriptUrl.protocol}//${scriptUrl.host}`;



    // Función para cargar CSS dinámicamente
    function loadCSS(href) {
        return new Promise((resolve, reject) => {
            // Verificar si ya está cargado
            if (document.getElementById('vz-styles')) {
                resolve();
                return;
            }

            const link = document.createElement('link');
            link.id = 'vz-styles';
            link.rel = 'stylesheet';
            link.href = href;
            link.onload = resolve;
            link.onerror = reject;
            document.head.appendChild(link);
        });
    }

    // Función principal de inicialización
    async function initWidget() {
        try {
            console.log('[Venzio] Inicializando widget...');

            // 1. Obtener autenticación
            const authUrl = `${apiBase}/widget/auth?site_id=${encodeURIComponent(siteId)}`;
            const authResponse = await fetch(authUrl);

            if (!authResponse.ok) {
                throw new Error(`Auth failed: ${authResponse.status}`);
            }

            const authData = await authResponse.json();
            console.log('[Venzio] Autenticación exitosa');

            // 2. Cargar CSS
            await loadCSS(`${apiBase}/widget/widget.css`);
            console.log('[Venzio] CSS cargado');

            // 3. Cargar widget.js usando dynamic import
            const module = await import(`${apiBase}/widget/widget.js`);
            const VenzioWidget = module.VenzioWidget;
            console.log('[Venzio] Widget.js cargado');

            // 4. Instanciar el widget
            const widget = new VenzioWidget({
                apiBase: `${apiBase}/api`,
                siteId: siteId,
                voiceId: authData.voice_id,
                token: authData.token,
                agentName: agentName
            });

            window.VenzioWidgetInstance = widget;
            console.log('[Venzio] Widget inicializado correctamente');

        } catch (error) {
            console.error('[Venzio] Error inicializando widget:', error);
        }
    }

    // Iniciar cuando el DOM esté listo
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWidget);
    } else {
        initWidget();
    }

})();