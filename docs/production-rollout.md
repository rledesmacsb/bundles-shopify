# CSBYTE Bundles — paso a producción

**Entorno de desarrollo:** `csbyte-bundle-dev.myshopify.com` / `csbyte-commerce-tools-dev.vercel.app`

**Proyecto de producción reservado:** `csbyte-commerce-tools-prod` (`prj_pO47i4sSGzFrFpLlPo6tZP8rpVWb`). No desplegado; las credenciales de desarrollo **no** se reutilizan.

## Condiciones de activación

1. Crear o configurar la aplicación de Shopify para la tienda principal desde el panel de desarrolladores de Shopify. Registrar su URL y OAuth redirect propias, diferentes de desarrollo.
2. Confirmar el dominio **myshopify.com** canónico de producción. No asumir que es `csbyte.cl`. Establecer exactamente ese dominio en `CSBYTE_ALLOWED_SHOPS`, sin comodines.
3. Crear una base PostgreSQL/Supabase independiente para producción, aplicar migraciones Prisma y asegurar los permisos de `public."Session"`. No reutilizar sesiones de desarrollo.
4. Establecer en el proyecto Vercel de producción los valores propios de `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, `SHOPIFY_APP_URL`, `DATABASE_URL`, `DIRECT_URL`, `CRON_SECRET` y `CSBYTE_ALLOWED_SHOPS`.
5. Vincular el repositorio `rledesmacsb/bundles-shopify` a una rama de producción estable. Requerir `npm run test:bundles && npm run typecheck && npm run build` antes de publicar.
6. Revisar configuración de la app Shopify: URL propia, URL OAuth y ámbitos autorizados. No apuntar el dominio de producción al proyecto Vercel `-dev`.
7. Instalar la app en la tienda principal a través del flujo oficial de autorización de Shopify. Un despliegue de Vercel por sí solo **no instala** una app en Shopify.
8. Verificar desde las credenciales **de esa misma app** `webhookSubscriptions(topics:[PRODUCTS_DELETE])` y comprobar que su URI apunta al proyecto de producción.
9. Confirmar permisos para crear, editar y publicar Bundles; publicar primero un Bundle controlado y revisar precio, SKU, componentes, imágenes, envío/peso y descuento de inventario.
10. Configurar regla comercial antes de habilitar actualizaciones de precio. Verificar que la actualización automática no sobrescribe precios editados a mano.
11. Confirmar que Vercel Cron usa `CRON_SECRET`, que la lista de tiendas autorizadas incluye únicamente producción y que el estado de la tarea diaria figura como exitoso.

## Barreras de seguridad incluidas

- El cron y `products/delete` comprueban `CSBYTE_ALLOWED_SHOPS`; si no está configurado, no modifican tiendas.
- El endpoint del cron exige `Authorization: Bearer` con comparación de tiempo constante.
- Los webhooks usan `authenticate.webhook` para validar la firma HMAC de Shopify.
- Los Bundles se identifican por ID de producto y variante, nunca se sustituyen automáticamente por productos con el mismo SKU.
- En casos de duplicación de SKU o componentes eliminados, bloquear publicación o pasar el Bundle a borrador tras una segunda revisión.

## Pendientes verificables antes de declarar producción disponible

- Registro efectivo de `products/delete` dentro de la aplicación (el conector Shopify de ChatGPT representa **otra** aplicación y no tiene visibilidad de sus suscripciones).
- Ejecución auténtica del cron desde Vercel (el mero despliegue de `vercel.json` prueba configuración, no ejecución).
- Prueba real de recálculo de precio en un Bundle gestionado, desencadenada por la app y no por una edición manual del precio del padre.
- Medición de carga completa en iPhone con una sesión válida de Shopify Admin.

**No activar la tienda principal mientras falten las credenciales independientes y las validaciones anteriores.**
