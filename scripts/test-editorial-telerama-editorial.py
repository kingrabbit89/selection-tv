#!/usr/bin/env python3
import datetime as dt
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('telerama_editorial',Path(__file__).with_name('editorial-telerama-editorial.py'))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def chars(text,x=24,top=100,size=8,bold=False,icon=False):
    font='Test+TeleramaIconsPrint-Regular' if icon else 'Test+Graphik-Bold' if bold else 'Test+Graphik-Regular'
    return [{'text':c,'x0':x+i*size/2,'x1':x+(i+1)*size/2,'top':top,'bottom':top+size,
             'size':size,'fontname':font,'upright':True,'matrix':(1,0,0,1,x+i*size/2,770-top)} for i,c in enumerate(text)]


def review(mark='u',title='A film',x=24,top=100,time='21.00'):
    return chars(mark,x,top,icon=True)+chars(time+' Arte Film',x+10,top)+chars(title,x,top+14,size=11,bold=True)


class EditorialTests(unittest.TestCase):
    def test_native_marks_keep_low_appreciations_and_never_become_external_scores(self):
        for glyph,label,count in [('r','Hélas',None),('t','Bof',1),('y','Bien',2),('u','Très bien',3),('i','Bravo',4)]:
            rows,rejected=module.page_reviews(review(glyph),dt.date(2026,10,10),99,592)
            self.assertEqual(rejected,[])
            self.assertEqual(rows[0]['native_rating'],{'glyph_code':glyph,'label':label,'t_count':count})
            self.assertIsNone(rows[0]['review_summary'])
            self.assertFalse(rows[0]['summary_reviewed'])
            self.assertNotIn('imdb',rows[0])

    def test_side_by_side_headers_and_titles_stay_separate(self):
        data=review('y','Left',x=24)+review('i','Right',x=340)
        rows,rejected=module.page_reviews(data,dt.date(2026,10,10),99,592)
        self.assertEqual([r['title'] for r in rows],['Left','Right'])
        self.assertEqual([r['native_rating']['label'] for r in rows],['Bien','Bravo'])
        self.assertEqual(rejected,[])

    def test_previous_header_above_does_not_clip_a_later_heading(self):
        data=review('y','Previous',x=104,top=100)+review('t','Chine Russie et Cie',x=24,top=475)+review('t','Another',x=340,top=475)
        rows,_=module.page_reviews(data,dt.date(2026,10,10),116,592)
        self.assertEqual(rows[1]['title'],'Chine Russie et Cie')

    def test_after_midnight_keeps_printed_day_and_next_civil_day(self):
        rows,_=module.page_reviews(review(time='0.20'),dt.date(2026,10,10),99,592)
        self.assertEqual(rows[0]['date'],'2026-10-11')
        self.assertEqual(rows[0]['grid_date'],'2026-10-10')
        self.assertEqual(rows[0]['start'],'00:20')
        self.assertIsNone(rows[0]['checked_at'])

    def test_legend_and_ordinary_letters_cannot_create_a_review(self):
        data=chars('u',icon=True,top=743,size=6.8)+chars('21.00 Arte Film',x=34,top=743,size=6.8)
        data+=chars('u',top=100)+chars('21.00 Arte Film',x=34,top=100)
        self.assertEqual(module.header_candidates(data),[])

    def test_unreadable_title_is_rejected_without_copying_body(self):
        data=review()[:-len('A film')]+chars('Article body must never be exported',top=118)
        rows,rejected=module.page_reviews(data,dt.date(2026,10,10),99,592)
        self.assertEqual(rows,[])
        self.assertEqual(rejected[0]['reason'],'unreadable_review_title')

    def test_invalid_times_and_unknown_marks_are_not_reconstructed(self):
        for data in [review(time='25.00'),review(time='21.99'),review(mark='z')]:
            self.assertEqual(module.header_candidates(data),[])


if __name__=='__main__':
    unittest.main()
