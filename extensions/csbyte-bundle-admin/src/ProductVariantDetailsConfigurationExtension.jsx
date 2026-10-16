import "@shopify/ui-extensions/preact";
import {render} from "preact";

export default async () => {
  render(
    <Extension />,
    document.body,
  );
};

function Extension() {
  const variant =
    shopify.data.variant;

  const components =
    variant
      ?.productVariantComponents ??
    [];

  return (
    <s-admin-block
      heading="Componentes de la variante"
      collapsed-summary={
        `${components.length} componente${components.length === 1 ? "" : "s"}`
      }
    >
      <s-stack
        direction="block"
        gap="base"
      >
        {components.length ===
        0 ? (
          <s-text>
            Shopify no informa componentes para esta variante.
          </s-text>
        ) : (
          components.map(
            (
              component,
              index,
            ) => (
              <s-stack
                key={
                  component.id
                }
                direction="block"
                gap="small"
              >
                <s-text type="strong">
                  {index + 1}.{" "}
                  {
                    component.displayName
                  }
                </s-text>

                <s-text>
                  SKU:{" "}
                  {
                    component.sku ||
                    "Sin SKU"
                  }
                </s-text>

                {component.productVariantUrl ? (
                  <s-link
                    href={
                      component.productVariantUrl
                    }
                  >
                    Ver variante componente
                  </s-link>
                ) : null}

                {index <
                components.length -
                  1 ? (
                  <s-divider />
                ) : null}
              </s-stack>
            ),
          )
        )}
      </s-stack>
    </s-admin-block>
  );
}
