import "@shopify/ui-extensions/preact";
import {render} from "preact";
import {useEffect, useState} from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const {data, query} = shopify;
  const variantId = data?.selected?.[0]?.id;

  const [components, setComponents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadComponents() {
      if (!variantId) {
        setError("No se pudo identificar la variante.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const result = await query(
          `#graphql
          query GetBundleVariantComponents($id: ID!) {
            productVariant(id: $id) {
              id
              productVariantComponents(first: 10) {
                nodes {
                  productVariant {
                    id
                    title
                    sku
                    product {
                      id
                      title
                    }
                  }
                }
              }
            }
          }
          `,
          {
            variables: {
              id: variantId,
            },
          },
        );

        if (cancelled) return;

        if (result.errors?.length) {
          setError("No se pudieron consultar los componentes de la variante.");
          setComponents([]);
          return;
        }

        const nodes =
          result.data?.productVariant?.productVariantComponents?.nodes ?? [];

        setComponents(
          nodes
            .map((node) => node?.productVariant)
            .filter(Boolean),
        );
      } catch (loadError) {
        if (cancelled) return;

        console.error(loadError);
        setError("No se pudieron consultar los componentes de la variante.");
        setComponents([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadComponents();

    return () => {
      cancelled = true;
    };
  }, [variantId, query]);

  if (loading) {
    return (
      <s-stack direction="block" gap="base">
        <s-text>Consultando componentes de la variante...</s-text>
      </s-stack>
    );
  }

  if (error) {
    return (
      <s-stack direction="block" gap="base">
        <s-text>{error}</s-text>
      </s-stack>
    );
  }

  if (components.length === 0) {
    return (
      <s-stack direction="block" gap="base">
        <s-text>
          Shopify no informa componentes nativos para esta variante.
        </s-text>
      </s-stack>
    );
  }

  return (
    <s-stack direction="block" gap="base">
      <s-text type="strong">
        {components.length} componente{components.length === 1 ? "" : "s"}
      </s-text>

      {components.map((component, index) => {
        const productNumericId = component.product?.id
          ?.split("/")
          .filter(Boolean)
          .at(-1);

        return (
          <s-stack
            key={component.id}
            direction="block"
            gap="small"
          >
            <s-text>
              {index + 1}. {component.product?.title ?? component.title}
            </s-text>

            <s-text>
              SKU: {component.sku || "Sin SKU"}
            </s-text>

            {productNumericId ? (
              <s-link href={`shopify:admin/products/${productNumericId}`}>
                Ver producto componente
              </s-link>
            ) : null}

            {index < components.length - 1 ? <s-divider /> : null}
          </s-stack>
        );
      })}
    </s-stack>
  );
}
