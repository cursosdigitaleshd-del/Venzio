/**
 * Venzio Widget Embed Loader
 * Loader universal que inicializa el widget de voz
 */

(function() {
    'use strict';

    console.log('[Venzio][DEBUG] embed loader start');

    // Evitar inicialización múltiple
    if (window.VenzioWidgetInstance) {
        console.warn('[Venzio] Widget ya inicializado');
        return;
    }

    window.__venzio_widget_loaded = true;

    // Buscar el script de embed
    const script = document.currentScript;
    if (!script) {
        console.error('[Venzio] No se pudo encontrar el script de embed');
        return;
    }

    // Leer atributos del script
    const siteId = script.getAttribute('data-site-id');
    const agentName = script.getAttribute('data-name') || 'Agente Venzio';

    console.log('[Venzio][DEBUG] siteId:', siteId);
    console.log('[Venzio][DEBUG] agentName:', agentName);

    if (!siteId) {
        console.error('[Venzio] data-site-id es requerido');
        return;
    }

    // Determinar URL base del API desde la URL del script
    const scriptUrl = new URL(script.src);
    const apiBase = `${scriptUrl.protocol}//${scriptUrl.host}`;

    console.log('[Venzio][DEBUG] apiBase:', apiBase);



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
            console.log('[Venzio][DEBUG] auth response:', authData);
            console.log('[Venzio] Autenticación exitosa');

            // 2. Cargar CSS
            await loadCSS(`${apiBase}/widget/widget.css`);
            console.log('[Venzio] CSS cargado');

            // 3. Cargar widget.js como script clásico
            console.log('[Venzio][DEBUG] loading widget script');
            const script = document.createElement("script");
            script.src = `${apiBase}/widget/widget.bundle.js?v=${Date.now()}`;
            document.body.appendChild(script);

            // 4. Esperar que VenzioWidget esté disponible en window
            let attempts = 0;
            while (!window.VenzioWidget && attempts < 50) {
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }

            if (!window.VenzioWidget) {
                throw new Error('VenzioWidget no se cargó correctamente');
            }

            console.log('[Venzio] Widget bundle cargado');

            // 5. Instanciar el widget
            const widget = new window.VenzioWidget({
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