import "@shopify/ui-extensions/preact";
import {render} from "preact";
import {useEffect, useState} from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const {data, query} = shopify;
  const productId = data?.selected?.[0]?.id;

  const [components, setComponents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadComponents() {
      if (!productId) {
        setError("No se pudo identificar el producto.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const result = await query(
          `#graphql
          query GetBundleComponents($id: ID!) {
            product(id: $id) {
              id
              bundleComponents(first: 10) {
                nodes {
                  componentProduct {
                    id
                    title
                  }
                }
              }
            }
          }
          `,
          {
            variables: {
              id: productId,
            },
          },
        );

        if (cancelled) return;

        if (result.errors?.length) {
          setError("No se pudieron consultar los componentes del bundle.");
          setComponents([]);
          return;
        }

        const nodes =
          result.data?.product?.bundleComponents?.nodes ?? [];

        setComponents(
          nodes
            .map((node) => node?.componentProduct)
            .filter(Boolean),
        );
      } catch (loadError) {
        if (cancelled) return;

        console.error(loadError);
        setError("No se pudieron consultar los componentes del bundle.");
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
  }, [productId, query]);

  if (loading) {
    return (
      <s-stack direction="block" gap="base">
        <s-text>Consultando componentes del bundle...</s-text>
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
          Shopify no informa componentes nativos para este producto.
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
        const numericId = component.id
          .split("/")
          .filter(Boolean)
          .at(-1);

        return (
          <s-stack
            key={component.id}
            direction="block"
            gap="small"
          >
            <s-text>
              {index + 1}. {component.title}
            </s-text>

            {numericId ? (
              <s-link href={`shopify:admin/products/${numericId}`}>
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
