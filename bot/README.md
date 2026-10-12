# Bot de WhatsApp de Moras & Mentas

Agente propio conectado a la **API oficial de WhatsApp (Cloud API de Meta)**, con Claude como cerebro. Corre en Cloud Functions del mismo proyecto de Firebase que el panel (`morasymentas-bac78`).

## Qué hace

- Responde a los clientes con tono profesional, usando solo la información de la chacra (se edita desde el panel: **WhatsApp → Información que usa el bot**).
- Antes de hablar de una fecha, mira las **fechas reservadas de la chacra** que marcás en el panel. Si está tomada, ofrece una semana antes o después.
- Manda el link del sitio cuando preguntan por servicios y el Instagram para fotos.
- Va completando una **consulta en el panel** (origen WhatsApp) con nombre, tipo de evento, fecha e invitados.
- **Te deriva el chat sin escribirle nada al cliente** cuando: pide visita, quiere reservar o señar, pide descuento, pide una persona, pregunta por lluvia, ya tiene un evento señado o confirmado, manda la consulta del Servicio Premium desde el sitio, manda un audio, o el bot no sabe.
- Te avisa a tu WhatsApp personal: si le escribiste al número del bot en las últimas 24 h el aviso es texto (gratis); si no, usa la plantilla `aviso_derivacion`.
- Si le escribís "pendientes" (o cualquier cosa) al número del bot desde tu WhatsApp, te contesta la lista de chats para atender.
- Junta varios mensajes seguidos del cliente en una sola respuesta, marca leído y muestra "escribiendo…".
- **Panel → WhatsApp**: chats para atender, conversación completa, responder, devolver al bot, pausarlo en un chat, encender/apagar el bot, revisar la conexión con Meta.
- **Conector MCP**: para manejar el WhatsApp desde Claude ("¿qué chats tengo para atender?", "respondele a Lucía que el jueves a las 18 está perfecto").

Si respondés vos (panel, conector o app con coexistencia), el bot se corre de ese chat hasta que lo devuelvas. Un chat derivado vuelve solo al bot después de 30 días sin movimiento.

## Puesta en marcha

### 0. Elegí el número (decisión importante)

Un número conectado a la API **deja de funcionar en la app de WhatsApp** del celular, y los chats viejos del celular no pasan al bot. Opciones:

- **Número nuevo solo para el bot (recomendado para arrancar).** Un chip nuevo. No perdés nada y probás tranquilo. Después cambiás el número del sitio (`WA_NUMBER` en `index.html`) para que las consultas vayan al bot.
- **Pasar el 098 361 104 a la API.** Las consultas del sitio llegan directo al bot, pero ese número sale de la app: respondés desde el panel. Antes, hacé copia de seguridad de los chats.
- **Mismo número en la app y en el bot (coexistencia).** Meta solo lo habilita a través de un proveedor oficial (Solution Partner) y suele tener costo mensual. El bot ya entiende los mensajes que mandás desde la app; habría que adaptar la conexión al proveedor.

El número tiene que poder recibir un SMS o una llamada para verificarlo.

### 1. Firebase: plan Blaze

[console.firebase.google.com](https://console.firebase.google.com) → proyecto **morasymentas** → abajo a la izquierda **Actualizar** → plan **Blaze** (pide tarjeta). Con este volumen queda dentro de lo gratuito. Recomendado: en Google Cloud → Facturación → Presupuestos, poné una alerta de US$ 5.

### 2. Anthropic: clave de la API

[console.anthropic.com](https://console.anthropic.com) → **Billing**: cargá crédito (US$ 10 alcanza para empezar y ver el consumo) → **API Keys** → **Create Key** → copiala (empieza con `sk-ant-`).

### 3. Meta: app, número y claves

1. [developers.facebook.com](https://developers.facebook.com) → **Mis apps** → **Crear app** → caso de uso **Conectarte con clientes a través de WhatsApp** → vinculala al portfolio comercial de Moras & Mentas (o creá uno).
2. En la app: **WhatsApp → Configuración de la API** → **Agregar número de teléfono** → nombre visible *Moras & Mentas*, categoría Eventos → verificá el número por SMS o llamada.
3. Anotá el **Identificador del número de teléfono** y el **Identificador de la cuenta de WhatsApp Business** (están en esa misma pantalla).
4. **Token permanente**: [business.facebook.com](https://business.facebook.com) → **Configuración** → **Usuarios del sistema** → **Agregar** (rol Administrador) → **Asignar activos**: la app (control total) y la cuenta de WhatsApp (control total) → **Generar token** → elegí la app → caducidad **Nunca** → permisos `whatsapp_business_messaging` y `whatsapp_business_management` → copialo.
5. **Clave secreta de la app**: en developers.facebook.com → tu app → **Configuración de la app → Básica** → **Clave secreta** → Mostrar → copiala.
6. **Plantilla de aviso**: WhatsApp Manager → **Plantillas de mensajes** → **Crear** → categoría **Utilidad** → nombre `aviso_derivacion` → idioma **Español** → cuerpo:
   `Tenés un chat para atender en WhatsApp: {{1}}. Motivo: {{2}}. Respondelo desde el panel de Moras & Mentas.`
   Ejemplos: `{{1}}` = *Lucía Pérez (091 234 567)*, `{{2}}` = *Quiere coordinar una visita* → enviar a revisión.
7. **Publicar la app**: en **Configuración de la app → Básica** poné como URL de política de privacidad `https://morasymentas.github.io/moras/privacidad.html` y pasá la app a **Publicada** (arriba, el interruptor de modo).

### 4. Subir el bot

Abrí [shell.cloud.google.com](https://shell.cloud.google.com) con la misma cuenta de Google de Firebase y pegá:

```bash
git clone https://github.com/morasymentas/moras.git && cd moras/bot && npm install && cd ..
npx -y firebase-tools@latest login --no-localhost
npx -y firebase-tools@latest deploy --only functions --project morasymentas-bac78
```

El deploy te va a preguntar, una sola vez:

| Te pide | Qué poner |
|---|---|
| `WA_PHONE_NUMBER_ID` | Identificador del número (paso 3.3) |
| `WA_WABA_ID` | Identificador de la cuenta de WhatsApp Business (paso 3.3) |
| `ADMIN_WA` | Tu WhatsApp personal para los avisos, sin 0 y con 598: 099 123 456 → `59899123456` |
| `AVISO_PLANTILLA` | Enter (queda `aviso_derivacion`) |
| `WA_TOKEN` | Token permanente (paso 3.4) |
| `WA_APP_SECRET` | Clave secreta de la app (paso 3.5) |
| `WA_VERIFY_TOKEN` | Una palabra inventada; la vas a repetir en el paso 5 |
| `ANTHROPIC_API_KEY` | Clave de Anthropic (paso 2) |
| `MCP_KEY` | Otra palabra inventada, larga; es la llave del conector |

Las claves quedan guardadas en Secret Manager de Google, no en GitHub. Si el primer deploy falla por permisos o APIs que se están activando, esperá dos minutos y repetí el último comando.

### 5. Conectar el webhook

developers.facebook.com → tu app → **WhatsApp → Configuración** → **Webhook** → **Editar**:
- URL de devolución de llamada: `https://us-central1-morasymentas-bac78.cloudfunctions.net/whatsapp`
- Token de verificación: la palabra de `WA_VERIFY_TOKEN`
- **Verificar y guardar** → en **Campos del webhook**, suscribite a **messages**.

### 6. Revisar y probar

1. Panel → **WhatsApp** → **Conexión con WhatsApp** → **Revisar conexión**. Si dice que la app no está suscripta, tocá **Suscribir ahora**. Si Meta dice que el número no está registrado (error 133010), activalo con un PIN de 6 números.
2. Desde tu WhatsApp personal escribile "hola" al número del bot: te contesta la lista de chats para atender (y quedan habilitados los avisos gratis por 24 h).
3. Desde otro celular escribí como si fueras un cliente.
4. En Firebase → Firestore → **Reglas**, fijate que no haya una regla que deje leer todo a cualquiera (por ejemplo `allow read: if true` sobre `{document=**}`): los chats se guardan en la colección `whatsapp`.

### 7. Conector MCP en Claude (opcional)

claude.ai → **Configuración → Conectores → Agregar conector personalizado** → URL:
`https://us-central1-morasymentas-bac78.cloudfunctions.net/mcp/<tu MCP_KEY>`

Herramientas: chats para atender, chats recientes, leer un chat, responder por WhatsApp, devolver al bot o pausarlo, fechas reservadas, consultar una fecha, encender o apagar el bot. Quien tenga ese link maneja tu WhatsApp: no lo compartas.

## Cambiar algo después

- **Información** (precios, horarios, qué incluye): desde el panel, sin tocar código.
- **Reglas** (cuándo deriva, tono): `lib/conocimiento.js`, y volver a correr el deploy.
- **Modelo**: por defecto `claude-haiku-5-5`; se puede cambiar el campo `modelo` del documento `config/bot` en Firestore.

## Para desarrollo

```
bot/
  index.js            funciones: whatsapp (webhook), panelWhatsapp (panel), mcp (conector)
  lib/webhook.js      valida la firma de Meta y reparte los avisos
  lib/procesar.js     qué hacer con cada mensaje (duplicados, agrupado, derivación)
  lib/agente.js       Claude + herramientas (consultar_fecha, registrar_datos, derivar_a_chinguer)
  lib/conocimiento.js reglas fijas e información inicial
  lib/datos.js        base: whatsapp/, config/bot, disponibilidad/chacra, consultas
  lib/avisos.js       avisos a Chinguer
  lib/panel.js        acciones del panel
  lib/mcp.js          servidor MCP (HTTP sin sesión)
  lib/wa.js           API de WhatsApp
  test/               pruebas con WhatsApp, Claude y la base simulados: npm test
```
