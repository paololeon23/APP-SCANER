# Lector DNI (PWA)

Escanea el Code 39 del costado del DNI peruano, muestra el número y lo lee en voz de mujer. Detecta duplicados y guarda un listado.

## Subir a Netlify

### Opción A — Arrastrar carpeta
1. Entra a [app.netlify.com](https://app.netlify.com)
2. **Add new site → Deploy manually**
3. Arrastra esta carpeta completa
4. Listo (HTTPS incluido)

### Opción B — Git
1. Crea un repo y sube esta carpeta
2. En Netlify: **Import from Git** → elige el repo
3. Publish directory: `.` (o déjalo vacío; ya está en `netlify.toml`)
4. Deploy

## Uso en el celular
1. Abre la URL de Netlify en Chrome (Android) o Safari (iPhone)
2. Pulsa **Escanear** y acepta la cámara
3. Enfoca el código del **costado** del DNI
4. Sale el DNI, el bot lo dice y queda en el listado

## Archivos que sube Netlify
- `index.html`
- `css/`, `js/`, `icons/`
- `manifest.webmanifest`, `sw.js`
- `netlify.toml`
