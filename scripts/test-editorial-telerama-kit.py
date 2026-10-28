#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('telerama_kit',Path(__file__).with_name('editorial-telerama-kit.py'))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def icon(text,x,top):
    return {'text':text,'x0':x,'x1':x+5,'top':top,'bottom':top+8,'size':8,'fontname':'Test+TeleramaIconsPrint-Regular','upright':True}


def observation(title,start,page=10,x=60,top=100,date='2026-12-26',overnight=False):
    return {'title':title,'start':start,'channel':'Arte','date':date,'pdf_page':page,'bbox':[x,top,x+50,top+8],'overnight':overnight}


REPORT={'range':{'from':'2026-12-26','to':'2027-01-01'},'observations':[
    observation('Film A','21:00',x=60,top=100),observation('Film B','14:00',x=200,top=200),
    observation('Matinale','06:30',x=60,top=40),observation('Film de nuit','01:10',x=200,top=600,overnight=True),
    observation('Le Titre imprimé','20:50',page=11,date='2026-12-27')]}


class GridMarkTests(unittest.TestCase):
    def test_the_mark_is_the_nearest_glyph_left_of_the_title_on_its_line(self):
        icons=[icon('y',20,100),icon('u',40,101),icon('i',40,130),icon('t',-30,100)]
        self.assertEqual(module.mark_for([60,100,110,108],icons),'TTT')
        self.assertIsNone(module.mark_for([60,160,110,168],icons))
        self.assertIsNone(module.mark_for([200,100,250,108],icons),'a glyph farther than 70 pt belongs to another row')
        self.assertIsNone(module.mark_for([60,100,110,108],[{'text':'z','x0':40,'top':100}]))

    def test_ratings_are_keyed_by_observation_index(self):
        chars={10:[icon('r',45,100)],11:[icon('i',45,100)]}
        self.assertEqual(module.grid_ratings(REPORT,lambda page:chars[page]),{'0':'Hélas','4':'TTTT'})


class SampleTests(unittest.TestCase):
    def test_three_distinct_rows_first_prime_time_and_night(self):
        rows=[o for o in REPORT['observations'] if o['pdf_page']==10]
        self.assertEqual([r['title'] for r in module.choose_samples(rows)],['Matinale','Film A','Film de nuit'])

    def test_a_row_is_never_sampled_twice(self):
        rows=[observation('Seul','21:00',overnight=True),observation('Autre','14:00',top=300)]
        self.assertEqual([r['title'] for r in module.choose_samples(rows)],['Seul','Autre'])
        self.assertEqual(module.choose_samples([]),[])


class PickTests(unittest.TestCase):
    def test_picks_match_by_date_or_day_name_start_and_printed_title(self):
        index,row=module.match_pick(REPORT,{'day':'dimanche','time':'20:50','printed':'Le titre imprimé'})
        self.assertEqual((index,row['pdf_page']),(4,11))
        index,_=module.match_pick(REPORT,{'date':'2026-12-26','time':'21:00','title':'Film A'})
        self.assertEqual(index,0)
        self.assertEqual(module.match_pick(REPORT,{'date':'2026-12-26','time':'21:05','printed':'Film A'}),(None,None))


if __name__=='__main__':
    unittest.main()
