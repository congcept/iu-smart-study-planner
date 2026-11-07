THESIS = thesis

.PHONY: all clean view

all: $(THESIS).pdf

$(THESIS).pdf: $(THESIS).tex
	pdflatex $(THESIS)
	pdflatex $(THESIS)
	pdflatex $(THESIS)

quick:
	pdflatex $(THESIS)

clean:
	rm -f *.aux *.bbl *.blg *.log *.out *.toc *.lof *.lot *.lol *.brf
	rm -f chapters/*.aux frontmatter/*.aux appendices/*.aux

view: $(THESIS).pdf
	open $(THESIS).pdf
