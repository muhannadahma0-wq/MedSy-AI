import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, IBM_Plex_Sans_Arabic, Playfair_Display, Amiri } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  variable: "--font-arabic",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

// Elegant display serif for emotional headlines ("A steady day…").
const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

// Arabic display serif — pairs with Playfair for RTL headlines.
const amiri = Amiri({
  subsets: ["arabic", "latin"],
  variable: "--font-arabic-serif",
  display: "swap",
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "MedSync AI",
  description:
    "A full-stack medication adherence assistant: smart reminders, drug interaction checking, AI health agents, report analysis with chat, bilingual support (English / Arabic) and real-time notifications.",
  keywords: [
    "MedSync AI",
    "medication adherence",
    "AI health agents",
    "drug interactions",
    "report analysis",
  ],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// Applied before hydration: restores the saved UI language direction so the
// RTL layout never flashes when the SPA mounts (client-only app).
const dirBootstrapScript = `try{var l=localStorage.getItem('medsync-language');if(l==='ar'){document.documentElement.lang='ar';document.documentElement.dir='rtl';}else{document.documentElement.lang='en';document.documentElement.dir='ltr';}}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      dir="ltr"
      className={`${jakarta.variable} ${plexArabic.variable} ${playfair.variable} ${amiri.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <script dangerouslySetInnerHTML={{ __html: dirBootstrapScript }} />
        {children}
      </body>
    </html>
  );
}
