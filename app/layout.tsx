import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Recompra CRM",
  description: "Controle simples de clientes, vendas, recompra e estoque.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
