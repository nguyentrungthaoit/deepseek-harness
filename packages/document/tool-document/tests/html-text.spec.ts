/** HTML-to-text conversion for Mammoth output, including lenient handling of markup Mammoth does not write. */
import { describe, expect, it } from 'vitest'
import { htmlText } from '../src/html-text.ts'

describe('htmlText', () => {
  it('turns paragraphs, headings, and list items into lines', () => {
    expect(htmlText('<h1>Title</h1><p>Body <strong>bold</strong></p><ul><li>one</li><li>two</li></ul><p> </p>'))
      .toBe('Title\nBody bold\none\ntwo')
  })

  it('keeps bare text, flattens nested blocks, and ignores images, inputs, and breaks between blocks', () => {
    expect(htmlText('loose <p>a<br/>b</p><img src="x"><br><input type="checkbox"><div><p>inner</p></div>  '))
      .toBe('loose\na\nb\ninner')
    expect(htmlText('<li><p>first</p><ol><li>nested</li></ol></li><li>x<img/><input/>y</li>')).toBe('first\nnested\nxy')
    expect(htmlText('<p><table><tr><td>t</td></tr></table></p>')).toBe('t')
  })

  it('keeps the inline text of a list item on one line when a nested list follows it', () => {
    expect(htmlText('<ul><li>Parent <strong>bold</strong> tail<ul><li>Child</li></ul></li></ul>')).toBe('Parent bold tail\nChild')
    expect(htmlText('<ol><li>a <em>b</em><ol><li>c</li></ol>after <strong>d</strong> <ol><li>e</li></ol> </li></ol>'))
      .toBe('a b\nc\nafter d\ne')
  })

  it('writes table rows with tab-separated cells, including header, body, and footer groups', () => {
    const html = '<table><thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td><p>a</p><p>b</p></td><td></td></tr></tbody>'
      + '<tfoot><tr><td>f\tg</td>note<td>x</td></tr></tfoot><caption>skip</caption>text</table>'
    expect(htmlText(html)).toBe('H1\tH2\na b\t\nf g\tx')
    expect(htmlText('<table></table><p>after</p>')).toBe('after')
  })

  it('reads cell content from inline elements, nested tables, and skipped elements', () => {
    expect(htmlText('<table><tr><td><span>s</span><img/><br/><input/><table><tr><td>in</td><td>ner</td></tr></table></td></tr></table>'))
      .toBe('s in ner')
  })

  it('decodes named and numeric entities and leaves invalid code points as written', () => {
    expect(htmlText('<p>&amp; &lt; &gt; &quot; &apos; &#65; &#x42; &#x110000; &#99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999; &nbsp;</p>'))
      .toBe('& < > " \' A B &#x110000; &#99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999; &nbsp;')
  })

  it('skips comments, doctypes, processing instructions, and attributes', () => {
    expect(htmlText('<!DOCTYPE html><?xml version="1.0"?><!-- hidden --><p class="x" data-a=\'1\' b=2 c = "3" d e/ >kept</p>'))
      .toBe('kept')
    expect(htmlText('<p>a</p><!-- never closed <p>b</p>')).toBe('a')
  })

  it('stops at malformed markup instead of throwing', () => {
    expect(htmlText('<p>a</p></p></p><p>b')).toBe('a\nb')
    expect(htmlText('<p>a</p></p')).toBe('a')
    expect(htmlText('<p>a</p><!doctype')).toBe('a')
    expect(htmlText('<p>a</p>< p>b</p>')).toBe('a')
    expect(htmlText('<p>a</p><p title="open>b')).toBe('a')
    expect(htmlText('<p =x>b</p>')).toBe('b')
    expect(htmlText('<p a=unquoted')).toBe('')
  })
})
