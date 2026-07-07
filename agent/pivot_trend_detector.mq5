//+------------------------------------------------------------------+
//|                                      Pivot Trend Detector.mq5   |
//+------------------------------------------------------------------+
#property copyright "PTD"
#property version   "1.00"
#property indicator_chart_window
#property indicator_buffers 8
#property indicator_plots   4

#property indicator_label1 "PTD slow line up"
#property indicator_type1  DRAW_LINE
#property indicator_color1 clrDodgerBlue
#property indicator_width1 2

#property indicator_label2 "PTD slow line down"
#property indicator_type2  DRAW_LINE
#property indicator_color2 clrCrimson
#property indicator_width2 2

#property indicator_label3 "PTD fast line"
#property indicator_type3  DRAW_COLOR_LINE
#property indicator_color3 clrDodgerBlue,clrCrimson
#property indicator_style3 STYLE_DOT

#property indicator_label4 "PTD trend start"
#property indicator_type4  DRAW_COLOR_ARROW
#property indicator_color4 clrDodgerBlue,clrCrimson
#property indicator_width4 2

#include <Canvas/Canvas.mqh>

CCanvas obj_Canvas;

input int   fastPeriod     = 5;
input int   slowPeriod     = 10;
input color upColor        = clrDodgerBlue;
input color downColor      = clrCrimson;
input int   fillOpacity    = 128;
input int   arrowCode      = 77;
input bool  showExtensions = true;
input bool  enableFilling  = true;
input int   extendBars     = 1;

double slowLineUpBuffer[], slowLineDownBuffer[], slowLineBuffer[];
double fastLineBuffer[], fastLineColorBuffer[];
double trendArrowColorBuffer[], trendArrowBuffer[], trendBuffer[];

int    currentChartWidth  = 0;
int    currentChartHeight = 0;
int    currentChartScale  = 0;
int    firstVisibleBarIndex = 0;
int    visibleBarsCount   = 0;
double minPrice = 0.0;
double maxPrice = 0.0;

static datetime lastRedrawTime = 0;
static double   previousTrend  = -1;
string objectPrefix = "PTD_";

//+------------------------------------------------------------------+
int OnInit()
  {
   currentChartWidth      = (int)ChartGetInteger(0, CHART_WIDTH_IN_PIXELS);
   currentChartHeight     = (int)ChartGetInteger(0, CHART_HEIGHT_IN_PIXELS);
   currentChartScale      = (int)ChartGetInteger(0, CHART_SCALE);
   firstVisibleBarIndex   = (int)ChartGetInteger(0, CHART_FIRST_VISIBLE_BAR);
   visibleBarsCount       = (int)ChartGetInteger(0, CHART_VISIBLE_BARS);
   minPrice               = ChartGetDouble(0, CHART_PRICE_MIN, 0);
   maxPrice               = ChartGetDouble(0, CHART_PRICE_MAX, 0);

   SetIndexBuffer(0, slowLineUpBuffer,     INDICATOR_DATA);
   SetIndexBuffer(1, slowLineDownBuffer,   INDICATOR_DATA);
   SetIndexBuffer(2, fastLineBuffer,       INDICATOR_DATA);
   SetIndexBuffer(3, fastLineColorBuffer,  INDICATOR_COLOR_INDEX);
   SetIndexBuffer(4, trendArrowBuffer,     INDICATOR_DATA);
   SetIndexBuffer(5, trendArrowColorBuffer,INDICATOR_COLOR_INDEX);
   SetIndexBuffer(6, trendBuffer,          INDICATOR_CALCULATIONS);
   SetIndexBuffer(7, slowLineBuffer,       INDICATOR_CALCULATIONS);

   PlotIndexSetInteger(0, PLOT_DRAW_BEGIN, slowPeriod);
   PlotIndexSetInteger(1, PLOT_DRAW_BEGIN, slowPeriod);
   PlotIndexSetInteger(2, PLOT_DRAW_BEGIN, fastPeriod);
   PlotIndexSetInteger(3, PLOT_DRAW_BEGIN, fastPeriod);
   PlotIndexSetInteger(4, PLOT_DRAW_BEGIN, slowPeriod);
   PlotIndexSetInteger(3, PLOT_ARROW,      arrowCode);

   PlotIndexSetInteger(0, PLOT_SHIFT, extendBars);
   PlotIndexSetInteger(1, PLOT_SHIFT, extendBars);
   PlotIndexSetInteger(2, PLOT_SHIFT, extendBars);
   PlotIndexSetInteger(3, PLOT_SHIFT, 0);

   PlotIndexSetInteger(0, PLOT_LINE_COLOR, 0, upColor);
   PlotIndexSetInteger(1, PLOT_LINE_COLOR, 0, downColor);
   PlotIndexSetInteger(2, PLOT_LINE_COLOR, 0, upColor);
   PlotIndexSetInteger(2, PLOT_LINE_COLOR, 1, downColor);
   PlotIndexSetInteger(4, PLOT_LINE_COLOR, 0, upColor);
   PlotIndexSetInteger(4, PLOT_LINE_COLOR, 1, downColor);

   if(enableFilling)
      obj_Canvas.CreateBitmapLabel(0, 0, "PTD_Canvas", 0, 0, currentChartWidth, currentChartHeight, COLOR_FORMAT_ARGB_NORMALIZE);

   string shortName = "PTD(" + IntegerToString(fastPeriod) + "," + IntegerToString(slowPeriod) + ")";
   IndicatorSetString(INDICATOR_SHORTNAME, shortName);
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
int OnCalculate(const int rates_total,
                const int prev_calculated,
                const datetime &time[],
                const double   &open[],
                const double   &high[],
                const double   &low[],
                const double   &close[],
                const long     &tick_volume[],
                const long     &volume[],
                const int      &spread[])
  {
   int startBar = prev_calculated - 1;
   if(startBar < 0) startBar = 0;

   for(int i = startBar; i < rates_total && !_StopFlag; i++)
     {
      int fStart = MathMax(0, i - fastPeriod + 1);
      int sStart = MathMax(0, i - slowPeriod + 1);

      double slowHigh = high[ArrayMaximum(high, sStart, slowPeriod)];
      double slowLow  = low [ArrayMinimum(low,  sStart, slowPeriod)];
      double fastHigh = high[ArrayMaximum(high, fStart, fastPeriod)];
      double fastLow  = low [ArrayMinimum(low,  fStart, fastPeriod)];

      if(i > 0)
        {
         slowLineBuffer[i] = (close[i] > slowLineBuffer[i-1]) ? slowLow  : slowHigh;
         fastLineBuffer[i] = (close[i] > fastLineBuffer[i-1]) ? fastLow  : fastHigh;
         trendBuffer[i]    = trendBuffer[i-1];
         if(close[i] < slowLineBuffer[i] && close[i] < fastLineBuffer[i]) trendBuffer[i] = 1;
         if(close[i] > slowLineBuffer[i] && close[i] > fastLineBuffer[i]) trendBuffer[i] = 0;
         trendArrowBuffer[i]    = (trendBuffer[i] != trendBuffer[i-1]) ? slowLineBuffer[i] : EMPTY_VALUE;
         slowLineUpBuffer[i]    = (trendBuffer[i] == 0) ? slowLineBuffer[i] : EMPTY_VALUE;
         slowLineDownBuffer[i]  = (trendBuffer[i] == 1) ? slowLineBuffer[i] : EMPTY_VALUE;
        }
      else
        {
         trendArrowBuffer[i] = slowLineUpBuffer[i] = slowLineDownBuffer[i] = EMPTY_VALUE;
         trendBuffer[i] = fastLineColorBuffer[i] = trendArrowColorBuffer[i] = 0;
         fastLineBuffer[i] = slowLineBuffer[i] = close[i];
        }
      fastLineColorBuffer[i]  = trendBuffer[i];
      trendArrowColorBuffer[i]= trendBuffer[i];
     }

   if(showExtensions && rates_total > 0)
     {
      int    li   = rates_total - 1;
      double sv   = slowLineBuffer[li];
      double fv   = fastLineBuffer[li];
      double tr   = trendBuffer[li];
      color  lc   = (tr == 0.0) ? upColor : downColor;
      datetime ct = iTime(_Symbol, _Period, 0);
      datetime et = ct + (datetime)((long)extendBars * PeriodSeconds(_Period));
      drawRightPrice(objectPrefix + "SLOW", et, sv, lc, STYLE_SOLID);
      drawRightPrice(objectPrefix + "FAST", et, fv, lc, STYLE_DOT);
     }

   if(!enableFilling) return(rates_total);

   bool isNewBar      = (rates_total > prev_calculated);
   bool trendChanged  = false;
   if(rates_total > 0 && trendBuffer[rates_total-1] != previousTrend)
     { trendChanged = true; previousTrend = trendBuffer[rates_total-1]; }

   bool chartChanged = false;
   int nW  = (int)ChartGetInteger(0, CHART_WIDTH_IN_PIXELS);
   int nH  = (int)ChartGetInteger(0, CHART_HEIGHT_IN_PIXELS);
   int nS  = (int)ChartGetInteger(0, CHART_SCALE);
   int nFV = (int)ChartGetInteger(0, CHART_FIRST_VISIBLE_BAR);
   int nVB = (int)ChartGetInteger(0, CHART_VISIBLE_BARS);
   double nMn = ChartGetDouble(0, CHART_PRICE_MIN, 0);
   double nMx = ChartGetDouble(0, CHART_PRICE_MAX, 0);

   if(nW != currentChartWidth || nH != currentChartHeight)
     { obj_Canvas.Resize(nW, nH); currentChartWidth = nW; currentChartHeight = nH; chartChanged = true; }
   if(nS != currentChartScale || nFV != firstVisibleBarIndex || nVB != visibleBarsCount || nMn != minPrice || nMx != maxPrice)
     { currentChartScale = nS; firstVisibleBarIndex = nFV; visibleBarsCount = nVB; minPrice = nMn; maxPrice = nMx; chartChanged = true; }

   datetime now = TimeCurrent();
   if((isNewBar || trendChanged || chartChanged) && (now - lastRedrawTime >= 1))
     { Redraw(); lastRedrawTime = now; }

   return(rates_total);
  }

//+------------------------------------------------------------------+
bool drawRightPrice(string name, datetime t, double price, color clr, ENUM_LINE_STYLE style = STYLE_SOLID)
  {
   if(ObjectFind(0, name) < 0)
     { if(!ObjectCreate(0, name, OBJ_ARROW_RIGHT_PRICE, 0, t, price)) return false; }
   else
     { ObjectSetInteger(0, name, OBJPROP_TIME, 0, t); ObjectSetDouble(0, name, OBJPROP_PRICE, 0, price); }
   int sc = (int)ChartGetInteger(0, CHART_SCALE);
   int w  = (sc <= 1) ? 1 : (sc <= 3) ? 2 : 3;
   ObjectSetInteger(0, name, OBJPROP_COLOR,      clr);
   ObjectSetInteger(0, name, OBJPROP_WIDTH,      w);
   ObjectSetInteger(0, name, OBJPROP_STYLE,      style);
   ObjectSetInteger(0, name, OBJPROP_BACK,       false);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTED,   false);
   ChartRedraw(0);
   return true;
  }

//+------------------------------------------------------------------+
int BarWidth(int scale) { return (int)MathPow(2.0, scale); }

int ShiftToX(int shift)
  { return (int)((firstVisibleBarIndex - shift) * BarWidth(currentChartScale) - 1); }

int PriceToY(double price)
  {
   if(maxPrice - minPrice == 0.0) return 0;
   return (int)MathRound(currentChartHeight * (maxPrice - price) / (maxPrice - minPrice) - 1);
  }

//+------------------------------------------------------------------+
void DrawFilling(const double &slow[], const double &fast[], const double &trend[],
                 color cUp, color cDn, uchar alpha, int ext)
  {
   int sz = (int)ArraySize(slow);
   if(sz == 0 || sz != ArraySize(fast) || sz != ArraySize(trend)) return;
   int total = visibleBarsCount + ext;
   int px = -1, py1 = -1, py2 = -1;
   for(int off = 0; off < total; off++)
     {
      int bar = firstVisibleBarIndex - off;
      int x   = ShiftToX(bar);
      if(x >= currentChartWidth) break;
      int bi  = sz - 1 - (firstVisibleBarIndex - off + ext);
      if(bi < 0 || bi >= sz) { px = -1; continue; }
      double v1 = slow[bi], v2 = fast[bi];
      if(v1 == EMPTY_VALUE || v2 == EMPTY_VALUE) { px = -1; continue; }
      int y1 = PriceToY(v1), y2 = PriceToY(v2);
      uint baseRGB = (trend[bi] == 0.0)
                   ? (ColorToARGB(cUp,255) & 0x00FFFFFF)
                   : (ColorToARGB(cDn,255) & 0x00FFFFFF);
      if(px != -1 && x > px)
        {
         double dx = x - px;
         int ec = MathMin(x, currentChartWidth - 1);
         for(int col = px; col <= ec; col++)
           {
            double t  = (col - px) / dx;
            double iy1 = py1 + t*(y1-py1), iy2 = py2 + t*(y2-py2);
            int uy = (int)MathRound(MathMin(iy1,iy2));
            int ly = (int)MathRound(MathMax(iy1,iy2));
            if(uy > ly) continue;
            double h = MathAbs(iy1-iy2);
            if(h == 0.0) continue;
            for(int row = uy; row <= ly; row++)
              {
               double dist = MathAbs(row - iy1);
               uchar  a    = (uchar)(alpha * (1.0 - dist/h));
               if(a > alpha) a = alpha;
               uint pc = ((uint)a << 24) | baseRGB;
               obj_Canvas.FillRectangle(col, row, col, row, pc);
              }
           }
        }
      px = x; py1 = y1; py2 = y2;
     }
  }

void Redraw()
  {
   if(currentChartWidth <= 0 || currentChartHeight <= 0) return;
   obj_Canvas.Erase(0);
   DrawFilling(slowLineBuffer, fastLineBuffer, trendBuffer, upColor, downColor, (uchar)fillOpacity, extendBars);
   obj_Canvas.Update();
  }

//+------------------------------------------------------------------+
void OnChartEvent(const int id, const long &lp, const double &dp, const string &sp)
  {
   if(id != CHARTEVENT_CHART_CHANGE || !enableFilling) return;
   int nW = (int)ChartGetInteger(0, CHART_WIDTH_IN_PIXELS);
   int nH = (int)ChartGetInteger(0, CHART_HEIGHT_IN_PIXELS);
   if(nW != currentChartWidth || nH != currentChartHeight)
     { obj_Canvas.Resize(nW, nH); currentChartWidth = nW; currentChartHeight = nH; Redraw(); return; }
   int nS  = (int)ChartGetInteger(0, CHART_SCALE);
   int nFV = (int)ChartGetInteger(0, CHART_FIRST_VISIBLE_BAR);
   int nVB = (int)ChartGetInteger(0, CHART_VISIBLE_BARS);
   double nMn = ChartGetDouble(0, CHART_PRICE_MIN, 0);
   double nMx = ChartGetDouble(0, CHART_PRICE_MAX, 0);
   if(nS != currentChartScale || nFV != firstVisibleBarIndex || nVB != visibleBarsCount || nMn != minPrice || nMx != maxPrice)
     { currentChartScale = nS; firstVisibleBarIndex = nFV; visibleBarsCount = nVB; minPrice = nMn; maxPrice = nMx; Redraw(); }
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   if(enableFilling) obj_Canvas.Destroy();
   ObjectsDeleteAll(0, objectPrefix, 0, OBJ_ARROW_RIGHT_PRICE);
   ChartRedraw(0);
  }
//+------------------------------------------------------------------+
