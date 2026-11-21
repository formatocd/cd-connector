# Documento de Requisitos de Software (PRD / SRS)
**Proyecto:** Cliente de Transferencia de Archivos Multiplataforma (Open Source)  
**Versión del documento:** 1.1 (MVP Consolidado)  
**Licencia del proyecto:** MIT  

---

## 1. Visión General y Objetivos
Desarrollar un cliente de transferencia de archivos de escritorio gratuito, de código abierto (licencia MIT) y multiplataforma (Windows, macOS y Linux). La aplicación busca ofrecer una experiencia moderna, rápida, intuitiva y ligera en consumo de recursos, eliminando la complejidad innecesaria de clientes heredados y garantizando la seguridad en la gestión de credenciales y sesiones.

### 1.1 Alcance del MVP (v1.0)
* Soporte nativo para protocolos **FTP**, **FTPS** y **SFTP**.
* Gestor centralizado de credenciales reutilizables con bóveda cifrada local y dos modos de seguridad configurables.
* Organización de conexiones en estructura de árbol jerárquico con importación/exportación portable.
* Interfaz modular con doble panel (local y remoto), panel de consola/comandos FTP y panel de cola de transferencias, todos con visibilidad independiente (mostrar/ocultar).
* Soporte para pestañas de múltiples sesiones simultáneas y cola de transferencias con resolución avanzada de conflictos.
* Temas visuales Claro y Oscuro.

---

## 2. Arquitectura Tecnológica Recomendada

| Capa | Tecnología | Justificación |
| :--- | :--- | :--- |
| **Core / Backend** | **Rust** (`tokio`, `suppaftp`, `russh`, `russh-sftp`) | Alto rendimiento en I/O asíncrono, seguridad de memoria y soporte nativo de FTP/FTPS/SFTP sin dependencias externas del SO. |
| **Framework Desktop** | **Tauri v2** | Binarios ligeros (~10-20 MB), bajo consumo de RAM (~40-70 MB) y empaquetado nativo multiplataforma. |
| **Frontend / UI** | **React + TypeScript + TailwindCSS** | Desarrollo ágil de componentes complejos (árboles, pestañas, paneles redimensionables, drag & drop) y soporte nativo para temas. |
| **Base de Datos Local** | **SQLite** (vía `rusqlite` / `sqlx`) | Almacenamiento local estructurado, transaccional y portable para sesiones, carpetas, credenciales y preferencias de UI. |
| **Criptografía** | **Argon2id + AES-256-GCM** (`argon2`, `aes-gcm`, `zeroize`) | Derivación de claves resistente a fuerza bruta, cifrado autenticado para secretos y borrado seguro en memoria. |

---

## 3. Requisitos Funcionales (RF)

### 3.1 Protocolos y Conexión
* **RF-01 (Protocolos soportados):** La aplicación debe permitir conexiones mediante **FTP** (plano), **FTPS** (explícito e implícito sobre TLS) y **SFTP** (sobre SSH).
* **RF-02 (Métodos de autenticación):**
  * **Mínimo obligatorio:** Usuario y contraseña.
  * **Extensible:** Autenticación mediante clave privada SSH (con o sin *passphrase*), agente SSH del sistema y certificados cliente TLS.
* **RF-03 (Parámetros de conexión):** Configuración de host, puerto (con valores por defecto según protocolo: `21` para FTP/FTPS, `22` para SFTP), modo pasivo/activo en FTP, directorio remoto inicial y directorio local inicial opcional.
* **RF-04 (Sesiones simultáneas):** Soporte para múltiples conexiones activas simultáneas organizadas mediante **pestañas** en la interfaz principal, permitiendo duplicar o cerrar sesiones de forma independiente.

### 3.2 Gestión de Credenciales y Seguridad
* **RF-05 (Credenciales reutilizables):** Debe existir una entidad de "Credenciales" independiente de las sesiones. Una misma credencial (ej. *Usuario Deploy Producción*) podrá asociarse a múltiples conexiones sin duplicar datos. Al actualizar la contraseña o clave en la credencial, el cambio aplicará automáticamente a todas las sesiones vinculadas.
* **RF-06 (Configuración inicial de seguridad):** En el primer arranque de la aplicación, un asistente inicial ofrecerá al usuario dos modos de funcionamiento para el almacén de secretos:
  * **Modo A — Con Contraseña Maestra:** El usuario define una contraseña maestra. La aplicación solicitará esta contraseña cada vez que se inicie para derivar la clave criptográfica (Argon2id) y desbloquear las credenciales.
  * **Modo B — Sin Contraseña Maestra (Cifrado Transparente):** La aplicación nunca pedirá contraseña al arrancar. El sistema generará automáticamente una clave aleatoria de alta entropía en la instalación y la almacenará localmente vinculada al entorno de usuario para cifrar/descifrar las contraseñas en base de datos.
* **RF-07 (Cambio de modo de seguridad):** El usuario podrá migrar del Modo B al Modo A (estableciendo una contraseña maestra y re-cifrando la bóveda) o viceversa desde los ajustes de seguridad.

### 3.3 Gestor de Sesiones y Portabilidad
* **RF-08 (Estructura en árbol):** Las sesiones guardadas deben organizarse en una vista de árbol jerárquico con soporte para carpetas y subcarpetas anidadas, permitiendo crear, renombrar, mover (drag & drop) y eliminar nodos.
* **RF-09 (Exportación e Importación):** La aplicación permitirá exportar e importar la estructura de carpetas, sesiones y credenciales en un archivo portable (formato JSON estructurado), comportándose según el modo de seguridad activo:
  * **Con Contraseña Maestra (Modo A):** El archivo exportado incluirá las credenciales cifradas con la contraseña maestra. Al importarlo en otra instancia, la aplicación solicitará dicha contraseña para descifrar e integrar las credenciales.
  * **Sin Contraseña Maestra (Modo B):** El archivo exportado será un fichero de texto plano (JSON) con toda la estructura de carpetas y datos de conexión, **omitiendo por completo las contraseñas y claves privadas** por seguridad.

### 3.4 Exploración, Gestión de Archivos y Layout Flexible
* **RF-10 (Vista de doble panel):** Cada pestaña de sesión presentará por defecto dos paneles lado a lado: **Sistema de archivos local** (izquierda) y **Sistema de archivos remoto** (derecha).
* **RF-11 (Visibilidad independiente de paneles):** La interfaz debe proporcionar controles rápidos (botones en la barra de herramientas/estado y atajos de teclado) para **mostrar u ocultar de forma independiente** los siguientes tres paneles:
  1. **Panel del explorador local** (permitiendo trabajar exclusivamente con la vista remota).
  2. **Panel de cola de transferencias**.
  3. **Panel de comandos / registro de sesión (Consola)**.
  * El estado de visibilidad de estos paneles debe persistir entre reinicios de la aplicación.
* **RF-12 (Operaciones básicas de archivos):** Tanto en local como en remoto se podrá navegar por directorios, crear carpetas, renombrar, eliminar, ver propiedades/permisos (chmod en SFTP/FTP) y actualizar el listado.
* **RF-13 (Drag & Drop integral):**
  * Arrastrar archivos y carpetas entre el panel local y el panel remoto (subida y descarga).
  * Arrastrar archivos y carpetas directamente desde el explorador nativo del sistema operativo (Windows Explorer, macOS Finder, Linux Nautilus/Dolphin) hacia el panel remoto de la aplicación (y viceversa, según soporte del SO).

### 3.5 Panel de Comandos FTP y Registro de Sesión
* **RF-14 (Registro de actividad en tiempo real):** Mostrará la traza de comunicación cliente-servidor de la pestaña activa (comandos enviados, códigos de respuesta FTP como `220`, `230`, `550`, o eventos de sesión SFTP), diferenciando visualmente peticiones, respuestas exitosas y errores.
* **RF-15 (Ejecución manual de comandos FTP):** Incluirá una línea de entrada (*prompt*) para que el usuario pueda enviar comandos FTP en crudo directamente al servidor activo (ej. `SITE CHMOD`, `STAT`, `FEAT`, `SYST`, `NOOP`) y visualizar su respuesta inmediata.
  * *Nota técnica SFTP:* Dado que SFTP es un protocolo binario sobre SSH y no basado en comandos de texto como FTP, cuando la pestaña activa sea SFTP el panel mostrará el registro de operaciones y eventos SSH/SFTP, deshabilitando o adaptando la entrada de comandos crudos con un aviso informativo.

### 3.6 Cola de Transferencias y Resolución de Conflictos
* **RF-16 (Cola de transferencias visible):** Panel inferior que mostrará las transferencias en curso, pendientes, completadas y fallidas, indicando progreso individual y global, velocidad actual, tiempo restante estimado y tamaño.
* **RF-17 (Control de la cola):** El usuario podrá pausar, reanudar, cancelar elementos individuales o toda la cola, reintentar transferencias fallidas y configurar un límite de transferencias simultáneas y límite de ancho de banda (subida/bajada).
* **RF-18 (Resolución de conflictos):** Cuando un archivo de destino ya exista, la aplicación detendrá ese elemento y mostrará un diálogo modal preguntando al usuario la acción a realizar:
  * **Sobrescribir**
  * **Sobrescribir si es más reciente / distinto tamaño**
  * **Omitir (Saltar)**
  * **Renombrar automáticamente** (ej. `archivo (1).ext`)
  * Debe incluir obligatoriamente una casilla **"Aplicar esta acción al resto de conflictos"** para la transferencia o lote en curso.

### 3.7 Apariencia e Interfaz de Usuario
* **RF-19 (Temas visuales):** Soporte para **Modo Claro** y **Modo Oscuro**, además de una opción para sincronizar automáticamente con el tema del sistema operativo.
* **RF-20 (Diseño limpio e intuitivo):** Interfaz libre de menús saturados, con iconografía clara para tipos de archivo, barra de rutas editable (*breadcrumbs* + ruta directa) y retroalimentación visual clara del estado de la conexión.

---

## 4. Requisitos No Funcionales (RNF)

* **RNF-01 (Multiplataforma y Distribución):** Compilación y generación de instaladores nativos para:
  * **Windows (x64 / ARM64):** `.msi` y `.exe` (NSIS).
  * **macOS (Universal Apple Silicon + Intel):** `.dmg` / `.app`.
  * **Linux (x64 / ARM64):** `.AppImage`, `.deb` y `.rpm`.
* **RNF-02 (Rendimiento y Memoria):** El consumo de memoria RAM en reposo con una sesión abierta no debe superar los 100 MB. El listado de directorios con más de 10.000 archivos debe virtualizarse en la UI para evitar bloqueos de renderizado.
* **RNF-03 (Seguridad en Memoria):** En Modo A, la clave derivada de la contraseña maestra debe mantenerse únicamente en memoria volátil durante la sesión y borrarse de forma segura al cerrar la aplicación (`zeroize`).
* **RNF-04 (Licencia Open Source):** Todo el código fuente y las dependencias de terceros deben ser compatibles con la **Licencia MIT**.

---

## 5. Modelo de Datos Conceptual (SQLite)

* **`credentials`**: `id`, `name` (alias descriptivo), `username`, `auth_type` (`password` | `ssh_key`), `encrypted_secret` (BLOB cifrado con AES-256-GCM), `nonce`, `created_at`, `updated_at`.
* **`folders`**: `id`, `parent_id` (autorreferencia nullable para el árbol jerárquico), `name`, `sort_order`.
* **`sessions`**: `id`, `folder_id` (nullable, raíz si es null), `credential_id` (FK opcional a `credentials`), `name`, `protocol` (`ftp` | `ftps` | `sftp`), `host`, `port`, `remote_initial_path`, `local_initial_path`, `passive_mode`, `sort_order`.
* **`app_config`**: `key`, `value` (almacena `security_mode`, `salt`, `verification_hash`, `theme`, `max_concurrent_transfers`, `ui_show_local_panel`, `ui_show_queue_panel`, `ui_show_command_panel`).

---

## 6. Fases de Desarrollo Sugeridas (Roadmap)

1. **Fase 1 (Cimientos y Seguridad):** Inicialización de proyecto Tauri v2 + React + TailwindCSS, esquema SQLite, motor criptográfico (Modo A y Modo B) y gestor de credenciales + árbol de sesiones (con importación/exportación).
2. **Fase 2 (Motor de Protocolos y Consola):** Implementación en Rust de conectores abstrayendo una interfaz común (`FileTransferClient` trait) para SFTP (`russh-sftp`) y FTP/FTPS (`suppaftp`), soporte para comandos crudos (`send_raw_command`) y emisión de logs en tiempo real.
3. **Fase 3 (UI Modular y Pestañas):** Construcción de la interfaz principal con temas claro/oscuro, pestañas de sesión, vista de doble panel con controles de visibilidad independientes (local, cola y comandos) y virtualización de tablas de archivos.
4. **Fase 4 (Cola de Transferencias y Drag & Drop):** Motor asíncrono de cola en Rust con concurrencia configurable, soporte de Drag & Drop interno y desde el SO, y modal de resolución de conflictos con opción *"Aplicar al resto"*.
5. **Fase 5 (Empaquetado y Release v1.0):** Configuración de pipelines de CI/CD (GitHub Actions) para compilar automáticamente `.exe`/`.msi`, `.dmg`, `.AppImage`, `.deb` y `.rpm` bajo licencia MIT.