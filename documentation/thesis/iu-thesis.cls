\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{iu-thesis}[2026/05/15 IU Smart Study Planner Thesis Class]

\LoadClass[12pt, oneside, letterpaper]{report}

% --- Geometry: IU margins ---
% Left 1.5in, Top 1.5in, Right 1in, Bottom 1.5in
% Page number at 1in from bottom => bottom margin 0.8in as per guideline
\RequirePackage[letterpaper,
  left=1.5in, top=1.5in, right=1in, bottom=0.8in,
  footskip=0.7in]{geometry}

% --- Font: Times New Roman ---
\RequirePackage{mathptmx}
\RequirePackage[T1]{fontenc}
\RequirePackage[utf8]{inputenc}

% --- Spacing: double-spaced ---
\RequirePackage{setspace}
\doublespacing

% --- Headers and footers ---
\RequirePackage{fancyhdr}
\pagestyle{fancy}
\fancyhf{}
\fancyfoot[C]{\thepage}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

% --- Page numbering ---
\pagenumbering{arabic}

% --- Captions ---
\RequirePackage[font=singlespacing, labelfont=bf]{caption}

% --- TOC formatting ---
\RequirePackage{tocloft}
\renewcommand{\cfttoctitlefont}{\hfill\bfseries}
\renewcommand{\cftaftertoctitle}{\hfill}
\renewcommand{\cftloftitlefont}{\hfill\bfseries}
\renewcommand{\cftafterloftitle}{\hfill}
\renewcommand{\cftlottitlefont}{\hfill\bfseries}
\renewcommand{\cftafterlottitle}{\hfill}

% --- Chapter headings: CHAPTER I, then Title ---
\RequirePackage{titlesec}
\titleformat{\chapter}[display]
  {\centering\normalfont\bfseries}
  {\MakeUppercase{\@chapapp}\ \thechapter}
  {0pt}
  {\centering\normalfont\bfseries}
\titlespacing*{\chapter}{0pt}{-20pt}{24pt}

% --- Section headings ---
\titleformat{\section}
  {\normalfont\bfseries}
  {\thesection.}
  {0.5em}
  {}
\titleformat{\subsection}
  {\normalfont\bfseries}
  {\thesubsection.}
  {0.5em}
  {}

% --- No indentation for first para after headings ---
\RequirePackage{indentfirst}

% --- Hyperlinks ---
\RequirePackage[colorlinks=true, linkcolor=black, citecolor=black, urlcolor=black]{hyperref}

% --- Graphics ---
\RequirePackage{graphicx}
\graphicspath{{figures/}}

% --- Tables ---
\RequirePackage{booktabs}
\RequirePackage{array}

% --- Code listings ---
\RequirePackage{listings}
\lstset{
  basicstyle=\footnotesize\ttfamily,
  breaklines=true,
  frame=single,
  tabsize=2,
  captionpos=b,
}

% --- Algorithms ---
\RequirePackage{algorithm2e}
\RestyleAlgo{boxed}

% --- Math ---
\RequirePackage{amsmath, amssymb}

% --- Bibliography ---
\RequirePackage[square,numbers,sort&compress]{natbib}

% --- Utilities ---
\RequirePackage{enumitem}
\RequirePackage{xcolor}
\RequirePackage{multirow}

% --- Preliminary page numbering (roman) ---
\newcommand{\frontmatter}{
  \pagenumbering{roman}
  \setcounter{page}{1}
}

\newcommand{\mainmatter}{
  \clearpage
  \pagenumbering{arabic}
  \setcounter{page}{1}
}

% --- Abstract environment ---
\renewenvironment{abstract}{
  \chapter*{ABSTRACT}
  \addcontentsline{toc}{chapter}{ABSTRACT}
  \singlespacing
}{
  \doublespacing
}

% --- Acknowledgements environment ---
\newenvironment{acknowledgments}{
  \chapter*{ACKNOWLEDGMENTS}
  \thispagestyle{empty}
  \singlespacing
}{
  \doublespacing
}
