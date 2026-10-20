PVObject_=pvModule
  Version=7.4
  Flags=$00900243

  PVObject_Commercial=pvCommercial
    Comment=Example Solar
    Flags=$0041
    Manufacturer=Example Solar
    Model=ES-M108-430
    DataSource=Manufacturer 2025
    YearBeg=2025
    Width=1.134
    Height=1.722
    Depth=0.030
    Weight=21.000
    NPieces=100
    Price=0.12
    Currency=EUR
    PriceDate=01/09/25 10:00
  End of PVObject pvCommercial

  Technol=mtSiMono
  NCelS=54
  NCelP=2
  NDiode=3
  SubModuleLayout=slTwinHalfCells
  GRef=1000
  TRef=25.0
  PNom=430.0
  PNomTolUp=1.50
  BifacialityFactor=0.800
  Isc=13.900
  Voc=38.90
  Imp=13.220
  Vmp=32.52
  muISC=6.95
  muVocSpec=-101.0
  muPmpReq=-0.300
  RShunt=400
  Rp_0=1600
  Rp_Exp=5.50
  RSerie=0.153
  Gamma=1.000
  muGamma=-0.0002
  VMaxIEC=1500

  PVObject_IAM=pvIAM
    Flags=$00
    IAMMode=UserProfile
    IAMProfile=TCubicProfile
      NPtsMax=9
      NPtsEff=5
      LastCompile=$B18D
      Mode=3
      Point_1=0.0,1.00000
      Point_2=40.0,0.99000
      Point_3=60.0,0.96000
      Point_4=80.0,0.66000
      Point_5=90.0,0.00000
    End of TCubicProfile
  End of PVObject pvIAM
End of PVObject pvModule
