# Age Recovery: asistente virtual con Microsoft Foundry

Prototipo de la **Fase 2 (Opción B)** del curso *Fundamentos de IA con Tecnologías Microsoft (AB-730 / AI-901)*.
**Alumno:** Vladimir Emanuel Alcalá Félix · **Instructor:** Jesús Brujería

**Prototipo en línea (sin login):** https://agerecovery-api-7m4q9x.azurewebsites.net

> Todos los datos usados en las pruebas son **ficticios o simulados**. El FAQ se generó a partir de la información pública del sitio web de la clínica y **no ha sido revisado por un profesional médico**.

---

## 1. Problema que resuelve

Los pacientes y visitantes de una clínica de medicina estética hacen las mismas preguntas una y otra vez: qué tratamientos existen, qué cuidados seguir después de uno, cómo agendar una valoración. Responderlas consume tiempo del personal, y fuera de horario quedan sin respuesta.

Al mismo tiempo, es un contexto sensible: una IA mal diseñada podría dar dosis, cotizar precios, diagnosticar o tranquilizar a alguien que en realidad tiene una complicación.

## 2. Solución

Un chat web que responde **únicamente información general** de la clínica (servicios y cuidados posteriores) usando un agente de **Microsoft Foundry** con **File Search** sobre un FAQ de 54 preguntas. El agente tiene reglas explícitas de seguridad:

- Se presenta siempre como asistente de IA y **no sustituye al médico**.
- **No da dosis, no cotiza precios, no diagnostica.** Para eso deriva a la clínica.
- Ante **señales de alarma** (dolor intenso, hinchazón, dificultad para respirar, fiebre, etc.) responde un mensaje corto: comunicarse de inmediato con la clínica o llamar al 911.
- **No pide ni repite datos personales o de salud**; recomienda no compartirlos.
- Resiste intentos de saltarse sus instrucciones (*jailbreak*).

## 3. Capturas del prototipo

| Pantalla inicial con aviso de IA | Servicios (respuesta del FAQ) |
|---|---|
| ![Inicio](docs/images/01-inicio.png) | ![Servicios](docs/images/02-servicios.png) |

| Precio: no cotiza | Señal de alarma |
|---|---|
| ![Precio](docs/images/03-precio.png) | ![Alarma](docs/images/04-alarma.png) |

| Intento de jailbreak | Datos personales |
|---|---|
| ![Jailbreak](docs/images/05-jailbreak.png) | ![Datos personales](docs/images/06-datos-personales.png) |

**Vista móvil**

![Móvil](docs/images/07-movil.png)

## 4. Arquitectura

```mermaid
flowchart LR
    U[Usuario<br/>navegador] -->|HTTPS| A[Azure App Service<br/>Linux B1 · Node.js 24<br/>Express]
    A -->|Identidad administrada<br/>rol Foundry User| F[Proyecto Microsoft Foundry<br/>Agent Service]
    F --> M[Modelo gpt-5]
    F --> V[(File Search<br/>vector store<br/>age-recovery-faq)]
    V --- D[faq-age-recovery.md<br/>54 preguntas]
```

Flujo: el navegador envía el mensaje a `/api/chat`; el servidor Express lo reenvía al agente de Foundry (`agent_reference`) conservando el `conversation_id` de la sesión; el agente consulta el FAQ con File Search y responde. El servidor **no usa API keys**: se autentica con la identidad administrada del App Service.

## 5. Servicios de Azure utilizados

| Servicio | Uso | Detalle |
|---|---|---|
| Microsoft Foundry (proyecto y agente) | Orquesta el agente `agerecovery-agent` (versión 4) | Región West US 3 |
| Modelo `gpt-5` | Genera las respuestas | Desplegado en Foundry |
| File Search (vector store `age-recovery-faq`) | Da al agente el conocimiento del FAQ | Sin Azure AI Search ni Foundry IQ |
| Azure App Service (Linux B1, Node 24) | Aloja el servidor y el frontend | Un solo recurso, aprox. 0.017 USD/hora |
| Identidad administrada + rol *Foundry User* | Autenticación sin claves | Sin secretos en el código |

## 6. IA responsable

La solución se evaluó con los seis principios de Microsoft para IA responsable.

### 6.1 Equidad

| Riesgo | Medida | Evidencia |
|---|---|---|
| Respuestas distintas según quién pregunta | El agente responde solo con el FAQ de la clínica y no pide ni usa edad, sexo, origen u otras características | El agente no solicita datos personales (captura `06-datos-personales.png`) |
| Estereotipos sobre belleza o apariencia | Las instrucciones limitan al agente a información de servicios y cuidados; no emite juicios sobre el aspecto de las personas | `agent/instrucciones.md` |

*Limitación honesta:* no se realizó una evaluación formal de sesgos con grupos de prueba. Está listado en la sección 7.

### 6.2 Confiabilidad y seguridad

| Riesgo | Medida | Evidencia |
|---|---|---|
| Complicación médica real tratada como consulta informativa | Sección *Señales de alarma* en las instrucciones: respuesta corta, derivación a la clínica y 911; no explica el síntoma ni menciona medicamentos | `04-alarma.png` |
| Dosis o cotizaciones inventadas | El agente indica que la clínica no publica precios y que las dosis las define el médico | `03-precio.png` |
| Jailbreak ("ignora tus instrucciones…") | El filtro de contenido de Foundry bloquea la solicitud y el servidor devuelve un mensaje fijo | `05-jailbreak.png` |
| Abuso o saturación del servicio | Límite de 20 peticiones por minuto por IP | `server.js` |
| Respuestas fuera de la base de conocimiento | File Search sobre un FAQ acotado de 54 preguntas | `agent/faq-age-recovery.md` |

### 6.3 Privacidad y seguridad de los datos

| Riesgo | Medida | Evidencia |
|---|---|---|
| El usuario comparte datos personales o de salud | El aviso de IA lo desaconseja y el agente no los repite ni los usa | `01-inicio.png`, `06-datos-personales.png` |
| Filtración de secretos | Sin API keys: identidad administrada con rol *Foundry User*. `.env` no está en Git ni en el paquete desplegado | `.gitignore`, App Settings con solo `FOUNDRY_PROJECT_ENDPOINT` y `FOUNDRY_AGENT_NAME` |
| Datos en los registros | Los logs del servidor **no guardan el contenido** de los mensajes | `server.js` |
| Inyección de HTML (XSS) | El texto del bot se inserta con `textContent`, nunca con `innerHTML` | `public/app.js` |
| Sin cuentas ni login | No se recolectan identidades; la conversación vive solo en memoria de la sesión y se reinicia al recargar | Diseño del prototipo |

### 6.4 Inclusión

| Riesgo | Medida | Evidencia |
|---|---|---|
| Texto difícil de leer | Contraste WCAG AA verificado: texto claro sobre tarjeta 14.55:1, dorado sobre tarjeta 5.46:1, enlaces 6.65:1, burbuja del usuario (texto blanco) 5.66:1 | `public/styles.css` |
| Uso solo con mouse | Foco visible con teclado, etiquetas ARIA (`aria-label`, `aria-live="polite"`), área de conversación semántica | `public/index.html` |
| Uso en celular | Diseño responsive, probado en vista móvil | `07-movil.png` |
| Idioma | Interfaz y respuestas en español | Capturas |

### 6.5 Transparencia

| Riesgo | Medida | Evidencia |
|---|---|---|
| Que el usuario crea que habla con una persona o con un médico | Aviso fijo: «Soy un asistente de IA. No sustituyo al médico. No compartas datos personales ni de salud.» y etiqueta «Asistente virtual» en cada respuesta | `01-inicio.png` |
| No saber qué puede o no hacer el asistente | El saludo inicial indica el alcance: información general de servicios y cuidados posteriores | `01-inicio.png` |
| Opacidad en las reglas | Las instrucciones del agente están versionadas y públicas en el repositorio | `agent/instrucciones.md` |

### 6.6 Rendición de cuentas

| Riesgo | Medida | Evidencia |
|---|---|---|
| Nadie responde por lo que dice la IA | Toda decisión clínica se deriva al médico de la clínica; el asistente no actúa como autoridad | `03-precio.png`, `04-alarma.png` |
| Cambios sin control | Las instrucciones y el conocimiento se versionan en Git y el agente tiene versiones numeradas en Foundry | Historial de commits |
| Resultados no verificados | Pruebas documentadas con capturas (servicios, precio, alarma, jailbreak, datos personales) | Sección 3 |
| Contenido médico sin revisión | Se declara expresamente que el FAQ no fue revisado por un profesional; requeriría revisión del responsable médico antes de uso real | Sección 7 |

## 7. Limitaciones conocidas

- **Sin login:** cualquier persona con la URL puede usarlo, por requisito de la entrega. El límite de 20 peticiones por minuto por IP es la única barrera.
- **Datos ficticios:** las pruebas usan datos inventados. No debe usarse con datos reales de pacientes.
- **FAQ sin revisión médica:** se generó desde el sitio web de la clínica. Antes de un uso real debe validarlo un profesional de salud.
- **Sin evaluación formal de sesgos:** se probaron escenarios representativos, no una batería sistemática con grupos distintos.
- **Pruebas de seguridad acotadas:** se probó un caso de jailbreak, uno de señales de alarma y uno de datos personales; no es una auditoría exhaustiva.
- **Modelo no determinista:** la redacción puede variar entre ejecuciones.
- **Detalles cosméticos:** pueden aparecer restos de citas del FAQ; el frontend limpia los más comunes (espacios antes de puntuación y marcadores `【…】`).
- **Fuentes externas:** el navegador carga Playfair Display y Plus Jakarta Sans desde Google Fonts.
- **Límite por IP en memoria:** se reinicia con el servidor y no se comparte entre instancias.

## 8. Estructura del repositorio

```
agent/
  instrucciones.md        Reglas del agente (transparencia, seguridad, privacidad)
  faq-age-recovery.md     FAQ de 54 preguntas (conocimiento para File Search)
docs/images/              Capturas de evidencia
public/                   Frontend (HTML, CSS y JavaScript sin frameworks)
scripts/
  create-agent.js         Crea el agente en Foundry
  add-knowledge.js        Sube el FAQ al vector store y crea una nueva versión del agente
server.js                 Express: /health, /api/config, /api/chat
.env.example              Variables necesarias (sin valores)
```

## 9. Cómo ejecutarlo en local

Requisitos: Node.js 24 o superior, Azure CLI con sesión iniciada (`az login`) y un proyecto de Foundry con un despliegue de modelo.

```powershell
npm install
copy .env.example .env      # completa las variables (ver abajo)
npm run create-agent        # crea el agente si no existe
npm run add-knowledge       # sube el FAQ y crea una nueva versión con File Search
npm run dev                 # inicia el servidor con .env cargado
```

Variables de `.env`:

| Variable | Uso |
|---|---|
| `FOUNDRY_PROJECT_ENDPOINT` | Endpoint del proyecto de Foundry |
| `FOUNDRY_AGENT_NAME` | Nombre del agente (`agerecovery-agent`) |
| `FOUNDRY_MODEL_DEPLOYMENT` | Despliegue del modelo (solo para crear el agente y agregar conocimiento) |
| `CLINIC_CONTACT_URL` | Opcional: enlace público para el botón «Agendar valoración» (si está vacía, el botón no se muestra) |

Abre `http://localhost:3000` (`/health` responde `{"status":"ok"}`). Cada cambio en `agent/instrucciones.md` requiere volver a correr `npm run add-knowledge`.

## 10. Despliegue en Azure

El servidor se publica en Azure App Service (Linux B1, Node 24) con un ZIP que contiene **solo** `package.json`, `package-lock.json`, `server.js` y `public/` (sin `.env`, `node_modules`, `.git`, `.github` ni `scripts`), usando `az webapp deploy --type zip`. El App Service usa identidad administrada con el rol *Foundry User* sobre el recurso de Foundry; las únicas App Settings son `FOUNDRY_PROJECT_ENDPOINT` y `FOUNDRY_AGENT_NAME`. Como no se configuró `CLINIC_CONTACT_URL`, el botón «Agendar valoración» no aparece; el agente indica agendar por WhatsApp o con el formulario del sitio de la clínica.

> **Lección aprendida:** `Compress-Archive` de PowerShell genera rutas internas con `\` y el despliegue falla con HTTP 400. Hay que crear el ZIP con `System.IO.Compression` usando `/` en los nombres de entrada.

## 11. Antes y después (versiones del agente)

La versión 2 del agente ofrecía cotizar y agendar por sí misma. La versión 4 **indica cómo hacerlo** (WhatsApp o formulario de la clínica) sin ofrecerlo, y refuerza la respuesta ante señales de alarma. Es un ejemplo del ciclo de mejora basado en pruebas.
