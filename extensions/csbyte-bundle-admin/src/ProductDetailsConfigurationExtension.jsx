import "@shopify/ui-extensions/preact";
import {render} from "preact";

export default async () => {
  render(
    <Extension />,
    document.body,
  );
};

function Extension() {
  const product =
    shopify.data.product;

  const components =
    product?.productComponents ??
    [];

  return (
    <s-admin-block
      heading="Componentes del bundle"
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
            Shopify no informa componentes para este producto.
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
                    component.title
                  }
                </s-text>

                <s-text>
                  Variantes utilizadas:{" "}
                  {
                    component.componentVariantsCount
                  }
                </s-text>

                {component.productUrl ? (
                  <s-link
                    href={
                      component.productUrl
                    }
                  >
                    Ver producto componente
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
